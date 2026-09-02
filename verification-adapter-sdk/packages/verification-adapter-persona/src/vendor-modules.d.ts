declare module 'persona' {
  export class Client {
    constructor(options: Record<string, unknown>);
    open(): void;
    destroy?(): void;
  }
}
