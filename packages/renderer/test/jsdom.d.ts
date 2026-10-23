// jsdom ships no types; tests only need to parse HTML and query the document.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    window: { document: Document };
  }
}
