"""Check shared image pins without building or downloading images.

Run: python3 -m unittest discover -s images -p 'test_*.py'
Requires Docker Buildx, but not a running Docker daemon.
"""

import json
import os
from pathlib import Path
import re
import subprocess
import unittest


IMAGES = Path(__file__).resolve().parent


def bake(**overrides):
    result = subprocess.run(
        ["docker", "buildx", "bake", "--print"],
        cwd=IMAGES,
        env={**os.environ, **overrides},
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)["target"]


class ImageVersionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.all_targets = bake()
        cls.targets = {
            name: target for name, target in cls.all_targets.items()
            if not name.startswith("al-")
        }

    def test_shared_tools_have_one_exact_version(self):
        shared = (
            "PYTHON", "PIP", "UV", "PNPM", "BUN", "GIT", "GIT_LFS",
            "GH", "CLAUDE_CODE", "CODEX", "OPENCODE", "PI", "FX", "YAY",
        )
        for tool in shared:
            key = f"{tool}_VERSION"
            with self.subTest(tool=tool):
                versions = {target["args"][key] for target in self.targets.values()}
                self.assertEqual(len(versions), 1)
                self.assertRegex(versions.pop(), r"^\d+\.\d+\.\d+$")

    def test_node_matrix_is_shared_with_universal(self):
        lts = self.targets["universal"]["args"]["NODE_VERSION"]
        self.assertEqual(lts, self.targets[f"node-{lts.split('.')[0]}"]["args"]["NODE_VERSION"])

    def test_python_tags_and_inheritance_follow_version(self):
        targets = bake(PYTHON_VERSION="3.99.7", TAG_SUFFIX="-pin-test")
        tags = [tag.rsplit(":", 1)[1] for tag in targets["python"]["tags"]]
        self.assertEqual(tags, ["3.99-pin-test", "3.99.7-pin-test"])
        self.assertEqual(targets["python"]["args"]["PYTHON_VERSION"], "3.99.7")
        self.assertEqual(targets["universal"]["args"]["PYTHON_VERSION"], "3.99.7")
        self.assertEqual(targets["universal"]["contexts"]["base"], "target:python")

    def test_legacy_targets_do_not_inherit_shared_versions(self):
        overridden = bake(
            PYTHON_VERSION="3.99.7", GIT_VERSION="9.8.7",
            PNPM_VERSION="9.8.7", NODE_LTS_MAJOR="26",
        )
        for name, target in self.all_targets.items():
            if name.startswith("al-"):
                with self.subTest(target=name):
                    self.assertEqual(overridden[name], target)
                    self.assertNotIn("GIT_VERSION", target.get("args", {}))
                    self.assertNotIn("PNPM_VERSION", target.get("args", {}))
        self.assertEqual(self.all_targets["al-python"]["args"], {"PYTHON_VERSION": "3.13.1"})

    def test_dockerfile_version_arguments_are_supplied_by_bake(self):
        for name, target in self.targets.items():
            dockerfile = IMAGES / target["context"] / target.get("dockerfile", "Dockerfile")
            for arg, default in re.findall(
                r"^ARG (\w+(?:_VERSION|_SHA256))(=.*)?$", dockerfile.read_text(), re.MULTILINE
            ):
                with self.subTest(target=name, arg=arg):
                    self.assertFalse(default, "Version defaults belong in Bake, not Dockerfiles")
                    self.assertTrue(target["args"].get(arg), f"Missing Bake value for {arg}")
                    if arg.endswith("_SHA256"):
                        self.assertRegex(target["args"][arg], r"^[0-9a-f]{64}$")

    def test_install_commands_consume_the_shared_pins(self):
        universal = self.targets["universal"]
        self.assertEqual(
            universal["contexts"]["bun"],
            f"docker-image://oven/bun:{universal['args']['BUN_VERSION']}",
        )
        expected = {
            "universal": [
                'COPY --from=bun /usr/local/bin/bun',
                '"pnpm@${PNPM_VERSION}"',
                '"@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"',
                '"@openai/codex@${CODEX_VERSION}"',
                '"opencode-ai@${OPENCODE_VERSION}"',
                '"@earendil-works/pi-coding-agent@${PI_VERSION}"',
                '/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz',
                '/v${GIT_LFS_VERSION}/git-lfs-linux-amd64-v${GIT_LFS_VERSION}.tar.gz',
                '/v${FX_VERSION}/fx-linux-x86_64.tar.gz',
            ],
            "python": ['"pip==${PIP_VERSION}"', '"uv==${UV_VERSION}"'],
            "node": ['"pnpm@${PNPM_VERSION}"'],
            "ubuntu": ['git-${GIT_VERSION}.tar.xz'],
            "arch": ['git-${GIT_VERSION}.tar.xz', 'yay_${YAY_VERSION}_x86_64.tar.gz'],
        }
        for image, pins in expected.items():
            source = (IMAGES / image / "Dockerfile").read_text()
            for pin in pins:
                with self.subTest(image=image, pin=pin):
                    self.assertIn(pin, source)


if __name__ == "__main__":
    unittest.main()
