import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const members = sqliteTable("members", { userId: text("user_id").primaryKey(), displayName: text("display_name").notNull(), createdAt: text("created_at").notNull() });
export const guestbook = sqliteTable("guestbook", { id: integer("id").primaryKey({ autoIncrement: true }), author: text("author").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull() });
export const posts = sqliteTable("posts", { id: integer("id").primaryKey({ autoIncrement: true }), kind: text("kind").notNull(), userId: text("user_id").notNull(), author: text("author").notNull(), title: text("title").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull() });
