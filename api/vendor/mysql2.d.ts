declare module "*/vendor/mysql2.cjs" {
  const mysql: typeof import("mysql2/promise") & { default?: typeof import("mysql2/promise") };
  export = mysql;
}
