export interface Sink {
  readonly name: string;
  /** Write a batch. Returns the number of records accepted. */
  write(records: any[]): Promise<number>;
  close(): Promise<void>;
}
