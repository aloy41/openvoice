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
