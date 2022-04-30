const { supabase } = require("./supabase");
const {
  parseAndUpdateChannelInfo,
  parseAndUpdateChannelFeed,
} = require("./channel");

const run = async (overallRunTimeLimit = 300000) => {
  const { data: channels } = await supabase
    .from("channel")
    .select("id, name, tg_id")
    .order("updated_at", { ascending: true })
    .limit(20);

  await supabase
    .from("channels")
    .update({
      updated_at: "now()",
    })
    .in(
      "id",
      channels.map(({ id }) => id)
    );

  let overallRunTime = 0;

  for (let { id: channelId, name, tg_id: tgId } of channels) {
    if (overallRunTime > overallRunTimeLimit) {
      break;
    }

    if (tgId.includes("_bot")) {
      continue;
    }

    console.log(
      `Start: ${name} (${channelId}). Overall run time: ${overallRunTime} msec`
    );

    const totalRunTime = (
      await Promise.all([
        parseAndUpdateChannelInfo(channelId),
        parseAndUpdateChannelFeed(channelId),
      ])
    ).reduce((totalRunTime, { runTime }) => totalRunTime + runTime, 0);

    console.log(`Total run time: ${totalRunTime} msec`);

    overallRunTime += totalRunTime;
  }

  console.log(`Finished. Overall run time: ${overallRunTime} msec`);
};

run(process.env.OVERALL_RUN_TIME_LIMIT || 300000);
