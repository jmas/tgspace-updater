const { parseByConfig } = require("tgspace-parser");
const { supabase } = require("./supabase");
const {
  parseTgUrl,
  convertToFullNumber,
  convertTimeToSeconds,
  isValidHttpUrl,
  getWordsCount,
  detectLang,
  requireConfig,
} = require("./utils");

const parseAndUpdateChannelInfo = async (channelId) => {
  const channelInfoConfig = requireConfig("channel_info");

  console.log("Read channel info...");

  const { data: channel } = await supabase
    .from("channel")
    .select("id, tg_id")
    .eq("id", channelId)
    .limit(1)
    .single();

  const { tg_id: tgChannelId } = channel;

  if (!tgChannelId) {
    console.log(`Wrong tgId. Channel: #${channelId}, @${tgChannelId}`);
    return { runTime: 0 };
  }

  const parseConfig = {
    ...channelInfoConfig,
    context: {
      tgChannelId,
    },
  };

  let runTime = 0;

  try {
    for await (let {
      title,
      description,
      verified,
      subscribers,
      iteration,
      startTime,
    } of await parseByConfig(parseConfig)) {
      const _runTime = new Date().getTime() - startTime;
      runTime = _runTime;

      console.log(`Run time: ${_runTime}`);
      console.log(`Iteration: ${iteration}`);

      const subscribersNumber =
        parseInt(subscribers.replace(/ /g, ""), 10) || 0;

      const dayStart = new Date();
      dayStart.setHours(-Math.ceil(new Date().getTimezoneOffset() / 60), 0, 0);

      const dayEnd = new Date();
      dayEnd.setHours(
        23 - Math.ceil(new Date().getTimezoneOffset() / 60),
        59,
        59
      );

      const {
        data: [metric],
      } = await supabase
        .from("metric")
        .select("id")
        .eq("entity_type", "channel")
        .eq("entity_id", channel.id)
        .eq("type", "subscribers")
        .gt("created_at", dayStart.toISOString())
        .lt("created_at", dayEnd.toISOString());

      await supabase.from("metric").upsert({
        id: metric ? metric.id : undefined,
        entity_type: "channel",
        entity_id: channel.id,
        type: "subscribers",
        value: subscribersNumber,
      });

      await supabase
        .from("channel")
        .update({
          name: title || `@${tgChannelId}`,
          description,
          verified: Boolean(verified),
          updated_at: "now()",
        })
        .match({
          id: channelId,
        });
    }
  } catch (error) {
    console.log(`Can't parse channel info. Probably redirect.`);
  }

  console.log("Parse channel info end.");

  return {
    runTime,
  };
};

const parseAndUpdateChannelFeed = async (channelId, runTimeLimit = 300000) => {
  const channelFeedConfig = requireConfig("channel_feed");

  console.log("Read channel feed...");

  const { data: channel } = await supabase
    .from("channel")
    .select("id, tg_id")
    .eq("id", channelId)
    .limit(1)
    .single();

  const { tg_id: tgChannelId } = channel;

  if (!tgChannelId) {
    console.log(`Wrong tgId. Channel: #${channelId}, @${tgChannelId}`);
    return { runTime: 0 };
  }

  const { data: posts, error } = await supabase
    .from("post")
    .select("published_at")
    .order("published_at", { ascending: false });

  const lastPublishedAt =
    posts.length > 0 ? new Date(posts[0].published_at) : new Date();

  lastPublishedAt.setHours(
    -Math.ceil(new Date().getTimezoneOffset() / 60),
    0,
    0
  );

  const untilPublishedAt = new Date(
    lastPublishedAt.getTime() - 24 * 60 * 60 * 1000 * 2
  ); // parse until lastPublishedAt - 2 days

  const parseConfig = {
    ...channelFeedConfig,
    context: {
      tgChannelId,
      untilPublishedAt,
    },
  };

  let runTime = 0;

  try {
    for await (let { messages, iteration, startTime } of parseByConfig(
      parseConfig
    )) {
      const _runTime = new Date().getTime() - startTime;
      runTime = _runTime;

      console.log(`Run time: ${_runTime} msec`);
      console.log(`Iteration: ${iteration}`);

      if (_runTime > runTimeLimit) {
        console.log("End run by time limit.");
        break;
      }

      const tgPostsIds = messages.map(({ tgMessageId }) => tgMessageId);

      const { data: posts } = await supabase
        .from("post")
        .select("id, tg_post_id")
        .in("tg_post_id", tgPostsIds);

      for (let message of messages) {
        const {
          text,
          textHtml,
          views,
          links,
          publishedAt,
          images = [],
          videos = [],
          voices = [],
          forwardedName,
          forwardedUrl,
        } = message;

        if (new Date(publishedAt) < untilPublishedAt) {
          continue;
        }

        if (posts.some((post) => post.tg_post_id === message.tgMessageId)) {
          // update
          const {
            data: [post],
          } = await supabase
            .from("post")
            .select("id")
            .eq("tg_post_id", message.tgMessageId);

          const {
            data: [metric],
          } = await supabase
            .from("metric")
            .select("id, value")
            .eq("entity_type", "post")
            .eq("entity_id", post.id)
            .eq("type", "views");

          const value = convertToFullNumber(views);

          if (metric && String(metric.value) !== String(value)) {
            await supabase
              .from("metric")
              .update({
                value,
              })
              .match({
                id: metric.id,
              });
          }
        } else {
          // insert

          let forwardedChannelId = undefined;

          if (forwardedUrl) {
            const { tgId } = parseTgUrl(forwardedUrl);
            let channel = undefined;

            const { data } = await supabase
              .from("channel")
              .select("id")
              .eq("tg_id", tgId);
            channel = data.length > 0 ? data[0] : undefined;

            if (
              !channel &&
              tgId &&
              !tgId.includes("_bot") &&
              !tgId.includes("joinchat")
            ) {
              const { data } = await supabase.from("channel").insert({
                tg_id: tgId,
                name: `@${tgId}`,
              });
              channel = data.length > 0 ? data[0] : undefined;
            }

            forwardedChannelId = channel ? channel.id : undefined;
          }

          // detect language
          const [langTuple] = detectLang(text);
          const [lang] = langTuple || [undefined, undefined];

          // get words count
          const wordsCount = getWordsCount(text);

          const { data, error } = await supabase.from("post").insert({
            tg_post_id: message.tgMessageId,
            // text: textHtml,
            words_count: wordsCount,
            images_count: images.length,
            videos_count: videos.length,
            voices_count: voices.length,
            duration:
              videos.reduce(
                (duration, { duration: _duration }) =>
                  duration + convertTimeToSeconds(_duration),
                0
              ) +
              voices.reduce(
                (duration, { duration: _duration }) =>
                  duration + convertTimeToSeconds(_duration),
                0
              ),
            lang,
            forwarded: Boolean(forwardedName),
            forwarded_channel_id: forwardedChannelId,
            channel_id: channel.id,
            published_at: publishedAt,
          });

          if (error) {
            throw error;
          }

          const [post] = data;

          await supabase.from("metric").insert({
            entity_id: post.id,
            entity_type: "post",
            type: "views",
            value: convertToFullNumber(views),
          });

          if (links.length > 0) {
            const { data: linksInDb } = await supabase
              .from("channel_link")
              .select("id, url")
              .in(
                "url",
                links.map(({ url }) => url)
              )
              .eq("channel_id", channel.id);

            const foundLinks = linksInDb.map(({ url }) => url);

            for (let { url } of links) {
              if (!isValidHttpUrl(url)) {
                continue;
              }

              if (!foundLinks.includes(url)) {
                await supabase.from("channel_link").upsert({
                  channel_id: channel.id,
                  host: new URL(url).hostname.replace(/^www\./, ""),
                  url,
                });
              }

              if (
                url.startsWith("https://t.me/") &&
                !url.includes("_bot") &&
                !url.includes("joinchat")
              ) {
                const { tgId } = parseTgUrl(url);

                if (tgId) {
                  const { data } = await supabase
                    .from("channel")
                    .select("id")
                    .eq("tg_id", tgId)
                    .limit(1);

                  if (data.length === 0) {
                    await supabase.from("channel").insert({
                      tg_id: tgId,
                      name: `@${tgId}`,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.log(`Can't parse feed. Probably redirect.`);
  }

  console.log("Parse channel feed end.");

  return { runTime };
};

module.exports = {
  parseAndUpdateChannelInfo,
  parseAndUpdateChannelFeed,
};
