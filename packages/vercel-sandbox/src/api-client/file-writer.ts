import zlib from "zlib";
import tar, { type Pack } from "tar-stream";
import { Readable } from "stream";

interface FileBuffer {
  /**
   * The name (path) of the file to write.
   */
  name: string;
  /**
   * The content of the file as a Buffer.
   */
  content: Buffer;
}

interface FileStream {
  /**
   * The name (path) of the file to write.
   */
  name: string;
  /**
   * A Readable stream to consume the content of the file.
   */
  content: Readable;
  /**
   * The expected size of the file. This is required to write
   * the header of the compressed file.
   */
  size: number;
}

/**
 * Allows to create a Readable stream with methods to write files
 * to it and to finish it. Files written are compressed together
 * and gzipped in the stream.
 */
export class FileWriter {
  public readable: Readable;
  private pack: Pack;

  constructor() {
    const gzip = zlib.createGzip();
    this.pack = tar.pack();
    this.readable = this.pack.pipe(gzip);
  }

  /**
   * Allows to add a file to the stream. Size is required to write
   * the tarball header so when content is a stream it must be
   * provided.
   *
   * Returns a Promise resolved once the file is written in the
   * stream.
   */
  async addFile(file: FileBuffer | FileStream) {
    return new Promise<void>((resolve, reject) => {
      const entry = this.pack.entry(
        "size" in file
          ? { name: file.name, size: file.size }
          : { name: file.name, size: file.content.length },
        (error) => {
          if (error) {
            return reject(error);
          } else {
            resolve();
          }
        },
      );

      if (file.content instanceof Readable) {
        file.content.pipe(entry);
      } else {
        entry.end(file.content);
      }
    });
  }

  /**
   * Allows to finish the stream returning a Promise that will
   * resolve once the readable is effectively closed or
   * errored.
   */
  async end() {
    return new Promise<void>((resolve, reject) => {
      this.readable.on("error", reject);
      this.readable.on("end", resolve);
      this.pack.finalize();
    });
  }
}
