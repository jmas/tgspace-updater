const { supabase, config, fetchChannelCount } = require("./config");
const { parseByConfig } = require("tgspace-parser");

// Fetch channel message last published at date
const fetchMessageLastPublishedAt = async (channelId) => {
  const { data: messages, error } = await supabase
    .from("messages")
    .select("published_at")
    .order("published_at", { ascending: false })
    .eq("channel_id", channelId)
    .limit(1);

  if (error) {
    console.trace(error);
    throw error;
  }

  if (messages.length > 0) {
    return messages[0].published_at;
  }

  return `${new Date().getFullYear()}-01-01T00:00:00+00:00`;
};

// Fetch target channels
const fetchTargetChannels = async (count = 10) => {
  const { data: channels, error } = await supabase
    .from("channels")
    .select("id, tg_channel_id")
    .order("updated_at", { ascending: true })
    .limit(count);

  if (error) {
    console.trace(error);
    throw error;
  }

  return channels;
};

// Update channel info
const updateChannelInfo = async (tgChannelId, channelId) => {
  const { title, image, description } = await parseByConfig({
    context: {
      tgChannelId,
    },
    target: "`https://t.me/s/${$c.tgChannelId}`",
    parse: [
      {
        key: "title",
        pick: [".tgme_channel_info_header_title", "content"],
      },
      {
        key: "image",
        pick: [".tgme_page_photo_image img", "attr", "src"],
      },
      {
        key: "description",
        pick: [".tgme_channel_info_description", "content"],
      },
    ],
  });

  const { error } = await supabase
    .from("channels")
    .update({
      name: title,
      image,
      info: description,
      updated_at: "now()",
    })
    .match({ id: channelId });

  if (error) {
    console.trace(`Update channels error (${channelId}): `, error);
    throw error;
  }
};

// Insert message
const insertMessage = async ({
  tgMessageId,
  channelId,
  message,
  publishedAt,
  media,
}) => {
  const { error } = await supabase.from("messages").insert({
    channel_id: channelId,
    tg_message_id: tgMessageId,
    message: message,
    published_at: publishedAt,
    media,
  });

  if (error) {
    console.trace(`Update channels error (${channelId}): `, error);
    throw error;
  }
};

// Update channel info, fetch latest messages and insert to db
const run = async () => {
  const targetChannels = await fetchTargetChannels(fetchChannelCount);

  for (let { id: channelId, tg_channel_id: tgChannelId } of targetChannels) {
    const hrstart = process.hrtime();
    const prefix = `[${tgChannelId}]`;

    console.log(
      `${prefix} START: tgChannelId: ${tgChannelId} channelId: ${channelId}`
    );

    // Parse and update channel info
    await updateChannelInfo(tgChannelId, channelId);

    const lastPublishedAt = await fetchMessageLastPublishedAt(channelId);

    const parseConfig = {
      ...config,
      context: {
        tgChannelId,
        lastPublishedAt,
      },
    };

    let insertCount = 0;

    // Parse and insert new messages
    for await (let { before, messages, lastPublishedAt } of parseByConfig(
      parseConfig
    )) {
      for (let {
        tgMessageId,
        message,
        images,
        videos,
        voices,
        publishedAt,
      } of messages) {
        if (new Date(publishedAt) > new Date(lastPublishedAt)) {
          const media = [
            ...images.map((image) => {
              return {
                type: "image",
                ...image,
              };
            }),
            ...videos.map((video) => {
              return {
                type: "video",
                ...video,
              };
            }),
            ...voices.map((voice) => {
              return {
                type: "voice",
                ...voice,
              };
            }),
          ];

          await insertMessage({
            tgMessageId,
            channelId,
            message,
            publishedAt,
            media,
          });

          insertCount++;
        }
      }

      console.info(`${prefix} insertCount: ${insertCount}`);
      console.info(`${prefix} before: ${before}`);
      console.info(`${prefix} messages.length: ${messages.length}`);
      console.info(`${prefix} lastPublishedAt: ${lastPublishedAt}`);
    }

    const hrend = process.hrtime(hrstart);
    console.info(`${prefix} END: %ds %dms`, hrend[0], hrend[1] / 1000000);
  }
};

module.exports = {
  run,
};
