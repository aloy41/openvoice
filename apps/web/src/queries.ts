/** Server-state hooks (TanStack Query) over the generated API client. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@openvoice/api-client";

import { api } from "./api/client";

export type CommunitySummary = components["schemas"]["CommunityOut"];
export type CommunityDetail = components["schemas"]["CommunityDetail"];
export type ChannelInfo = components["schemas"]["ChannelOut"];

export function useCommunities() {
  return useQuery({
    queryKey: ["communities"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/communities");
      if (error || !data) throw new Error("failed to load communities");
      return data.communities;
    },
  });
}

export function useCommunityDetail(communityId: string | null) {
  return useQuery({
    queryKey: ["community", communityId],
    enabled: communityId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/communities/{community_id}", {
        params: { path: { community_id: communityId! } },
      });
      if (error || !data) throw new Error("failed to load community");
      return data;
    },
  });
}

export function useCreateCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/api/v1/communities", { body: { name } });
      if (error || !data) throw new Error("failed to create community");
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["communities"] }),
  });
}

export function useRedeemInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await api.POST("/api/v1/invites/redeem", {
        body: { code: code.trim() },
      });
      if (error || !data) {
        const status = (error as { code?: string } | null)?.code;
        throw new Error(
          status === "rate_limited"
            ? "Too many attempts. Wait a few minutes."
            : "That invite is not valid.",
        );
      }
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["communities"] }),
  });
}

export type MessageInfo = components["schemas"]["MessageOut"];

export function useMessages(channelId: string | null) {
  return useQuery({
    queryKey: ["messages", channelId],
    enabled: channelId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/channels/{channel_id}/messages", {
        params: { path: { channel_id: channelId! } },
      });
      if (error || !data) throw new Error("failed to load messages");
      return data.messages;
    },
  });
}

export function useSendMessage(channelId: string | null) {
  return useMutation({
    mutationFn: async (content: string) => {
      const { data, error } = await api.POST("/api/v1/channels/{channel_id}/messages", {
        params: { path: { channel_id: channelId! } },
        body: { content },
      });
      if (error || !data) {
        const code = (error as { code?: string } | null)?.code;
        throw new Error(
          code === "rate_limited"
            ? "You are sending messages too fast."
            : code === "missing_permission"
              ? "You don't have permission to send messages here."
              : "The message could not be sent.",
        );
      }
      return data;
    },
  });
}

export function useEditMessage() {
  return useMutation({
    mutationFn: async (args: { messageId: string; content: string }) => {
      const { data, error } = await api.PATCH("/api/v1/messages/{message_id}", {
        params: { path: { message_id: args.messageId } },
        body: { content: args.content },
      });
      if (error || !data) throw new Error("The edit could not be saved.");
      return data;
    },
  });
}

export function useDeleteMessage() {
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await api.DELETE("/api/v1/messages/{message_id}", {
        params: { path: { message_id: messageId } },
      });
      if (error) throw new Error("The message could not be deleted.");
    },
  });
}

export function useCreateInvite(communityId: string | null) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/communities/{community_id}/invites", {
        params: { path: { community_id: communityId! } },
        body: { expires_in_hours: 24 * 7 },
      });
      if (error || !data) throw new Error("failed to create invite");
      return data;
    },
  });
}
