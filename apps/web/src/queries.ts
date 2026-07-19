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

export function usePresence(communityId: string | null) {
  return useQuery({
    queryKey: ["presence", communityId],
    enabled: communityId !== null,
    // Refetched on demand; live updates arrive via the WS presence signal.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/communities/{community_id}/presence", {
        params: { path: { community_id: communityId! } },
      });
      if (error || !data) throw new Error("failed to load presence");
      return data.online;
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
  const qc = useQueryClient();
  return useMutation({
    // The sender sees their own message immediately from the POST response;
    // the WS event for it deduplicates by id.
    onSuccess: (message) => {
      qc.setQueryData<MessageInfo[]>(["messages", message.channel_id], (old) => {
        if (!old) return old;
        if (old.some((m) => m.id === message.id)) return old;
        return [...old, message];
      });
    },
    mutationFn: async (args: { content: string; scheme?: "plaintext" | "passphrase-v1" }) => {
      const { data, error } = await api.POST("/api/v1/channels/{channel_id}/messages", {
        params: { path: { channel_id: channelId! } },
        body: { content: args.content, scheme: args.scheme ?? "plaintext" },
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
    mutationFn: async (args: {
      messageId: string;
      content: string;
      scheme?: "plaintext" | "passphrase-v1";
    }) => {
      const { data, error } = await api.PATCH("/api/v1/messages/{message_id}", {
        params: { path: { message_id: args.messageId } },
        body: { content: args.content, scheme: args.scheme ?? "plaintext" },
      });
      if (error || !data) throw new Error("The edit could not be saved.");
      return data;
    },
  });
}

export function useToggleReaction() {
  return useMutation({
    mutationFn: async (args: { messageId: string; emoji: string }) => {
      const { error } = await api.POST("/api/v1/messages/{message_id}/reactions", {
        params: { path: { message_id: args.messageId } },
        body: { emoji: args.emoji },
      });
      if (error) throw new Error("Could not react.");
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

export type MemberInfo = components["schemas"]["MemberOut"];
export type BanInfo = components["schemas"]["BanOut"];
export type DeviceInfo = components["schemas"]["DeviceOut"];
export type Profile = components["schemas"]["ProfileOut"];

export function useProfile(userId: string | null) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/users/{user_id}", {
        params: { path: { user_id: userId! } },
      });
      if (error || !data) throw new Error("failed to load profile");
      return data;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      display_name?: string;
      accent_color?: string | null;
      pronouns?: string | null;
      bio?: string | null;
    }) => {
      const { data, error } = await api.PATCH("/api/v1/users/me", { body: patch });
      if (error || !data) throw new Error("Could not save your profile.");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile"] });
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

export function useDevices(enabled: boolean) {
  return useQuery({
    queryKey: ["devices"],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/devices");
      if (error || !data) throw new Error("failed to load devices");
      return data.devices;
    },
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: string) => {
      const { error } = await api.DELETE("/api/v1/devices/{device_id}", {
        params: { path: { device_id: deviceId } },
      });
      if (error) throw new Error("Could not revoke that device.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export function useMembers(communityId: string | null) {
  return useQuery({
    queryKey: ["members", communityId],
    enabled: communityId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/communities/{community_id}/members", {
        params: { path: { community_id: communityId! } },
      });
      if (error || !data) throw new Error("failed to load members");
      return data.members;
    },
  });
}

export function useBans(communityId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["bans", communityId],
    enabled: communityId !== null && enabled,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/communities/{community_id}/bans", {
        params: { path: { community_id: communityId! } },
      });
      if (error || !data) throw new Error("failed to load bans");
      return data.bans;
    },
  });
}

export function useKickMember(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE(
        "/api/v1/communities/{community_id}/members/{user_id}",
        { params: { path: { community_id: communityId!, user_id: userId } } },
      );
      if (error) throw new Error("Could not kick that member.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["members", communityId] }),
  });
}

export function useBanMember(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.POST("/api/v1/communities/{community_id}/bans", {
        params: { path: { community_id: communityId! } },
        body: { user_id: userId },
      });
      if (error) throw new Error("Could not ban that member.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["members", communityId] });
      void qc.invalidateQueries({ queryKey: ["bans", communityId] });
    },
  });
}

export function useUnbanMember(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE(
        "/api/v1/communities/{community_id}/bans/{user_id}",
        { params: { path: { community_id: communityId!, user_id: userId } } },
      );
      if (error) throw new Error("Could not lift that ban.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["bans", communityId] }),
  });
}

export function useRenameCommunity(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await api.PATCH("/api/v1/communities/{community_id}", {
        params: { path: { community_id: communityId! } },
        body: { name },
      });
      if (error) throw new Error("Could not rename the community.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["community", communityId] });
      void qc.invalidateQueries({ queryKey: ["communities"] });
    },
  });
}

export function useCreateChannel(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      name: string;
      kind: "text" | "voice" | "category";
      parent_id?: string | null;
    }) => {
      const { data, error } = await api.POST("/api/v1/communities/{community_id}/channels", {
        params: { path: { community_id: communityId! } },
        body: { name: args.name, kind: args.kind, parent_id: args.parent_id ?? null },
      });
      if (error || !data) {
        const code = (error as { code?: string } | null)?.code;
        throw new Error(
          code === "missing_permission"
            ? "You don't have permission to manage channels here."
            : "Could not create the channel.",
        );
      }
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["community", communityId] }),
  });
}

export function useRenameChannel(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { channelId: string; name: string }) => {
      const { error } = await api.PATCH("/api/v1/channels/{channel_id}", {
        params: { path: { channel_id: args.channelId } },
        body: { name: args.name },
      });
      if (error) throw new Error("Could not rename the channel.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["community", communityId] }),
  });
}

export function useDeleteChannel(communityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await api.DELETE("/api/v1/channels/{channel_id}", {
        params: { path: { channel_id: channelId } },
      });
      if (error) throw new Error("Could not delete the channel.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["community", communityId] }),
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
