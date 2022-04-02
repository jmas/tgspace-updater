const { createClient } = require("@supabase/supabase-js");

if (
  !process.env.CONFIG ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_KEY
) {
  throw new Error("Env vars: CONFIG, SUPABASE_URL, SUPABASE_KEY are required!");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const config = JSON.parse(process.env.CONFIG);

const fetchChannelCount = parseInt(process.env.FETCH_CHANNELS_COUNT, 10) || 5;

module.exports = { fetchChannelCount, config, supabase };
