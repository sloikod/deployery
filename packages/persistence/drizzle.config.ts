import fs from "fs";

import { defineConfig } from "drizzle-kit";

function readEnv(name: string): string | undefined {
    if (process.env[name] !== undefined) {
        return process.env[name];
    }
    const filePath = process.env[`${name}_FILE`];
    return filePath ? fs.readFileSync(filePath, "utf8").trim() : undefined;
}

function resolveDbType() {
    const value = (readEnv("DB_TYPE") ?? "sqlite").toLowerCase();
    if (value === "postgres" || value === "postgresql" || value === "postgresdb") {
        return "postgres";
    }
    return "sqlite";
}

function buildPostgresUrl(): string {
    const directUrl = readEnv("DB_POSTGRESDB_CONNECTION_URL");
    if (directUrl) {
        return directUrl;
    }

    const host = readEnv("DB_POSTGRESDB_HOST") ?? "127.0.0.1";
    const port = readEnv("DB_POSTGRESDB_PORT") ?? "5432";
    const database = readEnv("DB_POSTGRESDB_DATABASE") ?? "deployery";
    const user = readEnv("DB_POSTGRESDB_USER") ?? "postgres";
    const password = readEnv("DB_POSTGRESDB_PASSWORD") ?? "";
    const sslEnabled = readEnv("DB_POSTGRESDB_SSL_ENABLED") === "true";
    const auth = password.length > 0 ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
    const sslMode = sslEnabled ? "?sslmode=require" : "";
    return `postgresql://${auth}@${host}:${port}/${database}${sslMode}`;
}

const dbType = resolveDbType();

export default defineConfig(
    dbType === "postgres"
        ? {
              dialect: "postgresql",
              schema: "./src/schema.postgres.ts",
              out: "./drizzle/postgres",
              dbCredentials: {
                  url: buildPostgresUrl(),
              },
          }
        : {
              dialect: "sqlite",
              schema: "./src/schema.ts",
              out: "./drizzle/sqlite",
              dbCredentials: {
                  url: readEnv("DB_SQLITE_PATH") ?? readEnv("DEPLOYERY_SQLITE_PATH") ?? "./deployery.sqlite",
              },
          }
);
