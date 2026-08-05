export type RUNTIMES = "node26" | "node24" | "node22" | "python3.13";

export type ManagedImage =
  | "universal"
  | "universal:latest"
  | "node"
  | "node:22"
  | "node:24"
  | "node:26"
  | "python"
  | "python:3.14"
  | "ubuntu"
  | "ubuntu:latest"
  | "arch"
  | "arch:latest";
