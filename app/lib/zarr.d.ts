// zarr@0.6.3's package.json "exports" map omits a "types" condition, so
// TypeScript (moduleResolution: bundler) can't resolve its shipped .d.ts.
// This shim covers just what zarrLoader.ts uses.
declare module "zarr" {
  export class HTTPStore {
    constructor(url: string, options?: { fetchOptions?: RequestInit });
    url: string;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface ZarrArray {
    shape: number[];
    attrs: { asObject(): Promise<any> };
    get(selection: unknown): Promise<{ data: any; shape: number[] }>;
  }

  export function openArray(options: {
    store: HTTPStore;
    path: string;
    mode?: string;
  }): Promise<ZarrArray>;
}
