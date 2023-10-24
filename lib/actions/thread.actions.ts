'use server';

import { connectToDB } from "@/lib/mongoose";
import Thread from "@/lib/models/thread.model";
import User from '@/lib/models/user.model';
import { revalidatePath } from "next/cache";

interface Params {
    text: string;
    author: string;
    communityId: string | null;
    path: string;
}

export async function createThread({ text, author, communityId, path }: Params) {
    try {
        connectToDB();

        // @ts-ignore
        const createdThread = await Thread.create({
            text,
            author,
            community: null,// Assign communityId if provided, or leave it null for personal account
        });

        //Update user model
        await User.findByIdAndUpdate(author, {
            $push: { threads: createdThread._id },
        });

        revalidatePath(path)

    }
    catch (error: any) {
        throw new Error(`Failed to create thread: ${error.message}`);
    };

}

export async function fetchPosts(pageNumber = 1, pageSize = 20) {
    connectToDB();

    // Calculate the number of posts to skip based on the page number and page size.
    const skipAmount = (pageNumber - 1) * pageSize;

    // Create a query to fetch the posts that have no parent (top-level threads) (a thread that is not a comment/reply).
    const postsQuery = Thread.find({ parentId: { $in: [null, undefined] } })
        .sort({ createdAt: "desc" })
        .skip(skipAmount)
        .limit(pageSize)
        .populate({
            path: "author",
            model: User,
        })
        .populate({
            path: "children", // Populate the children field
            populate: {
                path: "author", // Populate the author field within children
                model: User,
                select: "_id name parentId image", // Select only _id and username fields of the author
            },
        });

    // Count the total number of top-level posts (threads) i.e., threads that are not comments.
    const totalPostsCount = await Thread.countDocuments({
        parentId: { $in: [null, undefined] },
    }); // Get the total count of posts

    const posts = await postsQuery.exec();

    const isNext = totalPostsCount > skipAmount + posts.length;

    return { posts, isNext };
}

export async function fetchThreadById(id: string,) {
    connectToDB();

    try {
        //TODO: Populate Community

        const thread = await Thread.findById(id)
            .populate({
                path: 'author',
                model: User,
                select: '_id id name image ',
            })
            .populate({
                path: 'children',
                populate: [
                    {
                        path: 'author',
                        model: User,
                        select: '_id id name parentId image '
                    },
                    {
                        path: 'children',
                        model: Thread,
                        populate: {
                            path: 'author',
                            model: User,
                            select: '_id id name parentId image '
                        }
                    },
                ]
            }).exec();

        return thread;
    } catch (error: any) {
        throw new Error(`Failed to fetch thread: ${error.message}`);
    }
}

export async function addCommentToThread(
    threadId: string,
    commentText: string,
    userId: string,
    path: string,
) {
    connectToDB();

    try {
        //Find the original thread by its ID

        const originalThread = await Thread.findById(threadId);

        if (!originalThread) {
            throw new Error('Thread not found');
        }
        //Create a new thread with the comment text

        const commentThread = new Thread({
            text: commentText,
            author: userId,
            parentId: threadId,
        });

        // Save the new thread

        const savedCommentThread = await commentThread.save();

        originalThread.children.push(savedCommentThread._id);

        // Save the original thread

        await originalThread.save();

        revalidatePath(path);
    }
    catch (error: any) {
        throw new Error(`Failed to adding comment to thread: ${error.message}`);
    }
}

export async function likePost(postId: string, userId: string, likes: string[], path: string) {
    connectToDB();

    try {
        const thread = await Thread.findByIdAndUpdate(
            postId,
            {
                userId: userId,
                likes: likes
            },
            { new: true }
        );

        if (userId && userId.trim() !== "") {
            const indexToRemove = thread.likes.findIndex((like: any) => like === userId);
            if (indexToRemove !== -1) {
                thread.likes.splice(indexToRemove, 1);
            } else {
                thread.likes.push(userId);
            }
        }

        const updatedThread = await thread.save();

        await updatedThread.save();
        revalidatePath(path)
        return updatedThread.likes
    } catch (error: any) {
        throw new Error(`Failed to add like to post: ${error.message}`);
    }
}