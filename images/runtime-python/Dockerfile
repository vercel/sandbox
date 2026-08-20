FROM builder-base AS builder-python

ARG PYTHON_VERSION=3.13.1

RUN mkdir -p /vercel/runtimes/python && \
    wget "https://www.python.org/ftp/python/$PYTHON_VERSION/Python-$PYTHON_VERSION.tgz" && \
    tar -xvf "Python-$PYTHON_VERSION.tgz" && \
    cd "Python-$PYTHON_VERSION" && \
    ./configure --enable-optimizations --prefix=/vercel/runtimes/python && \
    make -j $NUM_CORES && \
    make install && \
    cd .. && \
    rm -rf "Python-$PYTHON_VERSION" "Python-$PYTHON_VERSION.tgz"

ENV PATH="/opt/git/bin:/vercel/runtimes/python/bin:/home/vercel-sandbox/.local/bin:/usr/local/bin:${PATH}"

RUN python3 -m pip install --upgrade pip && \
    pip install uv

RUN rm -rf \
  /vercel/runtimes/python/lib/python3.13/test \
  /vercel/runtimes/python/lib/python3.13/__pycache__ \
  /vercel/runtimes/python/lib/python3.13/ensurepip \
  /vercel/runtimes/python/lib/python3.13/idlelib \
  /vercel/runtimes/python/lib/python3.13/tkinter \
  /vercel/runtimes/python/lib/python3.13/distutils \
  /vercel/runtimes/python/lib/pkgconfig \
  /vercel/runtimes/python/share

# Convenience symlink so `python`, `python3` and `python3.13` all work.
RUN ln --relative --symbolic /vercel/runtimes/python/bin/python3 /vercel/runtimes/python/bin/python

FROM sandbox-base AS sandbox-python

# Copy compiled Python and git from builder stage
COPY --from=builder-python /vercel/runtimes/python /vercel/runtimes/python

ENV PATH="/vercel/runtimes/python/bin:${PATH}"

USER vercel-sandbox

RUN python3 --version && \
    pip3 --version && \
    python3 -m venv -h && \
    uv --version
