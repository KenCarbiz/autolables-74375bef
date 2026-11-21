// The rtgip/3 modules are byte-for-byte copies of the Gateway's and use Object.hasOwn (ES2022), which
// Node 22, Deno and workerd all provide; the app compiles against the ES2020 lib, so only the type is added.
interface ObjectConstructor {
  hasOwn(o: object, v: PropertyKey): boolean;
}
