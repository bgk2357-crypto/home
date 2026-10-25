import { integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";
export const members = sqliteTable("members", { userId: text("user_id").primaryKey(), displayName: text("display_name").notNull(), createdAt: text("created_at").notNull(), email:text("email").notNull().default(""),role:text("role").notNull().default("preliminary"),businessName:text("business_name").notNull().default(""),businessSize:text("business_size").notNull().default(""),contactName:text("contact_name").notNull().default(""),jobTitle:text("job_title").notNull().default(""),phone:text("phone").notNull().default(""),profileCompletedAt:text("profile_completed_at"),updatedAt:text("updated_at"),version:integer("version").notNull().default(0) });
export const guestbook = sqliteTable("guestbook", { id: integer("id").primaryKey({ autoIncrement: true }), author: text("author").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull() });
export const posts = sqliteTable("posts", { id: integer("id").primaryKey({ autoIncrement: true }), kind: text("kind").notNull(), userId: text("user_id").notNull(), author: text("author").notNull(), title: text("title").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull(),answer:text("answer").notNull().default(""),answeredAt:text("answered_at"),answeredBy:text("answered_by") });
export const newsFeedCache = sqliteTable("news_feed_cache", {
  sourceId: text("source_id").primaryKey(),
  itemsJson: text("items_json").notNull(),
  fetchedAt: text("fetched_at"),
  checkedAt: text("checked_at").notNull(),
  failed: integer("failed").notNull().default(0),
});
export const safetyPosts = sqliteTable("safety_posts", {
 id:text("id").primaryKey(), userId:text("user_id").notNull(), author:text("author").notNull(),
 category:text("category").notNull(), title:text("title").notNull(), body:text("body").notNull(),
 createdAt:text("created_at").notNull(), published:integer("published").notNull().default(0),
});
export const safetyFiles = sqliteTable("safety_files", {
 id:text("id").primaryKey(), postId:text("post_id").notNull().references(()=>safetyPosts.id,{onDelete:"cascade"}),
 name:text("name").notNull(),size:integer("size").notNull(),staticPath:text("static_path"),
});
export const safetyFileChunks = sqliteTable("safety_file_chunks", {
 fileId:text("file_id").notNull().references(()=>safetyFiles.id,{onDelete:"cascade"}),part:integer("part").notNull(),data:text("data").notNull(),
},table=>[primaryKey({columns:[table.fileId,table.part]})]);
export const memberPaidRequests=sqliteTable("member_paid_requests",{
 id:text("id").primaryKey(),userId:text("user_id").notNull().references(()=>members.userId),status:text("status").notNull().default("pending"),note:text("note").notNull(),createdAt:text("created_at").notNull(),reviewedAt:text("reviewed_at"),reviewedBy:text("reviewed_by"),reviewNote:text("review_note").notNull().default(""),amount:integer("amount").notNull().default(0),paymentReference:text("payment_reference").notNull().default(""),
});
export const memberAudit=sqliteTable("member_audit",{
 id:integer("id").primaryKey({autoIncrement:true}),operationId:text("operation_id").notNull().unique(),actorId:text("actor_id").notNull(),targetId:text("target_id").notNull(),action:text("action").notNull(),oldRole:text("old_role").notNull(),newRole:text("new_role").notNull(),reason:text("reason").notNull(),createdAt:text("created_at").notNull(),
});
