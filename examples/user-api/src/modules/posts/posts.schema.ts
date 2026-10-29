import { z } from 'zod';
import { UserIdSchema } from '../users/users.schema.js';

export const PostIdSchema = z.uuid().brand<'PostId'>().describe('Unique UUIDv4 post identifier');
export type PostId = z.output<typeof PostIdSchema>;

export const PostSchema = z
  .object({
    id: PostIdSchema,
    authorId: UserIdSchema,
    title: z.string().trim().min(3).max(120),
    content: z.string().trim().min(1).max(5000),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Post', title: 'Post', description: 'Author post item' });
export type PostItem = z.output<typeof PostSchema>;

export const CreatePostSchema = PostSchema.omit({ id: true, createdAt: true }).meta({
  id: 'CreatePostInput',
  title: 'CreatePostInput',
});
export type CreatePostInput = z.output<typeof CreatePostSchema>;

export const UpdatePostSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    content: z.string().trim().min(1).max(5000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update a post.',
  })
  .meta({ id: 'UpdatePostInput', title: 'UpdatePostInput' });
export type UpdatePostInput = z.output<typeof UpdatePostSchema>;

export const PostIdParamsSchema = z.object({ id: PostIdSchema });
