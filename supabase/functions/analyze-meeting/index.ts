import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  transcript?: string;
  title?: string;
  committee?: string;
  attendees?: string;
  meeting_date?: string | null;
};

const COMM_NAMES: Record<string, string> = {
  fb: "Food & Bev",
  inv: "Inventory",
  mkt: "Marketing",
  gx: "Guest Exp.",
  vol: "Volunteers",
  all: "Full committee",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "ANTHROPIC_API_KEY missing — add it under Supabase Dashboard → Edge Functions → Secrets",
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { transcript, title, committee, attendees, meeting_date }: Body =
      await req.json();
    const text = (transcript || "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "Missing transcript" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an AI meeting analyst for a 13-person steering committee organizing The Dugout 2026, a 2-day event at Hot Shops Omaha during the College World Series opening weekend (June 12–13, 2026).

Meeting title: "${title || "Untitled"}"
Committee: ${COMM_NAMES[committee || ""] || committee || "General"}
Attendees present: ${attendees || "Not specified"}
Date: ${meeting_date || "Unknown"}

TRANSCRIPT:
${text}

Analyze this meeting transcript carefully. Return ONLY valid JSON — no markdown, no preamble:

{
  "summary": "2–3 sentence TL;DR of what was discussed and decided",
  "decisions": [
    "Clear decision that was made (start with a verb)",
    "Another decision"
  ],
  "action_items": [
    {
      "title": "Specific actionable task (start with a verb)",
      "assigned_to": "Full name of the person responsible — pick from attendees list if possible, or infer from context",
      "due_date": "YYYY-MM-DD if mentioned, otherwise null",
      "priority": "urgent|high|medium|low — infer from tone and context",
      "notes": "Brief context or details from the meeting"
    }
  ],
  "full_notes": "Structured markdown-style notes. Use sections like ## Topics Discussed, ## Decisions, ## Next Steps. Be thorough but clear."
}

RULES:
- Extract EVERY action item mentioned, even casually
- Match assigned_to names to the attendees list when possible
- If someone says "I'll handle X" attribute it to them
- Decisions are things that were agreed on, not things that need to happen
- Priority: urgent = needs to happen before next meeting, high = this week, medium = this month, low = general backlog`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const d = await resp.json();
    if (!resp.ok) {
      const msg =
        d?.error?.message ||
        d?.error?.type ||
        JSON.stringify(d).slice(0, 400);
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const raw =
      d.content?.map((c: { text?: string }) => c.text || "").join("") || "";
    const txt = raw.replace(/```json|```/g, "").trim();
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(txt);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Claude did not return valid JSON. Try again or shorten the transcript.",
          raw_preview: txt.slice(0, 500),
        }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
