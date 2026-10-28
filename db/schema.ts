import { integer, sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";
export const members = sqliteTable("members", { userId: text("user_id").primaryKey(), displayName: text("display_name").notNull(), createdAt: text("created_at").notNull(), email:text("email").notNull().default(""),role:text("role").notNull().default("preliminary"),businessName:text("business_name").notNull().default(""),businessSize:text("business_size").notNull().default(""),contactName:text("contact_name").notNull().default(""),jobTitle:text("job_title").notNull().default(""),phone:text("phone").notNull().default(""),profileCompletedAt:text("profile_completed_at"),updatedAt:text("updated_at"),version:integer("version").notNull().default(0),deletedAt:text("deleted_at") });
export const guestbook = sqliteTable("guestbook", { userId:text("user_id"),ownerHash:text("owner_hash"), id: integer("id").primaryKey({ autoIncrement: true }), author: text("author").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull() });
export const posts = sqliteTable("posts", { id: integer("id").primaryKey({ autoIncrement: true }), kind: text("kind").notNull(), userId: text("user_id").notNull(), author: text("author").notNull(), title: text("title").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull(),answer:text("answer").notNull().default(""),answeredAt:text("answered_at"),answeredBy:text("answered_by"),version:integer("version").notNull().default(1),updatedAt:text("updated_at") });
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
export const msdsAssets = sqliteTable('msds_assets', {
 id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>members.userId),payload:text('payload').notNull(),version:integer('version').notNull().default(1),fileName:text('file_name').notNull().default(''),fileSize:integer('file_size').notNull().default(0),updatedAt:text('updated_at').notNull(),lastOp:text('last_op').notNull(),
},table=>[index('msds_assets_owner').on(table.userId,table.updatedAt)]);
export const msdsOriginalChunks = sqliteTable('msds_original_chunks', {
 assetId:text('asset_id').notNull().references(()=>msdsAssets.id,{onDelete:'cascade'}),part:integer('part').notNull(),data:text('data').notNull(),
},table=>[primaryKey({columns:[table.assetId,table.part]})]);
export const msdsWorkspaceSettings = sqliteTable('msds_workspace_settings', {
 userId:text('user_id').primaryKey().references(()=>members.userId),payload:text('payload').notNull(),version:integer('version').notNull().default(1),
});
export const msdsPublicationEvents=sqliteTable('msds_publication_events',{
 id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>members.userId),assetId:text('asset_id').notNull(),payload:text('payload').notNull(),createdAt:text('created_at').notNull(),
},table=>[index('msds_publication_events_owner').on(table.userId,table.createdAt)]);
export const authCredentials=sqliteTable('auth_credentials',{
 email:text('email').primaryKey(),userId:text('user_id').notNull().unique().references(()=>members.userId),passwordHash:text('password_hash'),googleUserId:text('google_user_id').unique(),sessionVersion:integer('session_version').notNull().default(0),updatedAt:text('updated_at').notNull(),
});
export const authRateLimits=sqliteTable('auth_rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()});

export const communityComments=sqliteTable('community_comments',{id:integer('id').primaryKey({autoIncrement:true}),postId:integer('post_id').notNull().references(()=>posts.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>members.userId),author:text('author').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at'),version:integer('version').notNull().default(1)},table=>[index('community_comments_post').on(table.postId,table.id)]);
export const contentFilters=sqliteTable('content_filters',{id:integer('id').primaryKey({autoIncrement:true}),kind:text('kind').notNull(),expression:text('expression').notNull().unique(),createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull()});
export const moderationAudit=sqliteTable('moderation_audit',{id:integer('id').primaryKey({autoIncrement:true}),actorId:text('actor_id').notNull(),action:text('action').notNull(),expression:text('expression').notNull(),createdAt:text('created_at').notNull()});
export const authPasswordResets=sqliteTable('auth_password_resets',{tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().unique().references(()=>members.userId),expiresAt:integer('expires_at').notNull(),consumedBy:text('consumed_by'),createdAt:text('created_at').notNull()});
export const authRetiredIdentities=sqliteTable('auth_retired_identities',{userId:text('user_id').primaryKey()});
