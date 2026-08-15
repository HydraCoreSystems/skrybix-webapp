import { NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { handleAcknowledgeRequest } from "./handler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest, { params }: { params: { recordId: string } }) {
  return handleAcknowledgeRequest(request, params.recordId, getSupabaseServerClient());
}
