declare module "*.json" {
  const value: import("./core/types").Catalog;
  export default value;
}
