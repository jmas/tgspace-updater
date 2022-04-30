const fs = require("fs");
const getStrWordsCount = require("words-count").default;
const LanguageDetect = require("languagedetect");

const lngDetector = new LanguageDetect();

const parseTgUrl = (url) => {
  const [, tgId, postId] = url.match(
    /^https?:\/\/t.me\/(?:s\/)?([\w_0-9]+)(?:\/(\d+))?/i
  ) || [undefined, undefined, undefined];

  if (/\d+/.test(tgId)) {
    return { tgId: undefined, postId: tgId };
  }

  if (!tgId || tgId.length < 5) {
    return { tgId: undefined, postId: undefined };
  }

  return { tgId, postId };
};

const convertToFullNumber = (str) => {
  const [, num, multiplier] = str.match(/(\d*(?:\.\d+)?)(\w)?/);
  return (
    parseFloat(num) *
    (multiplier === "K" ? 1000 : multiplier === "M" ? 1000000 : 1)
  );
};

const convertTimeToSeconds = (time) => {
  return Number(time.split(":")[0]) * 60 + Number(time.split(":")[1]) || 0;
};

const isValidHttpUrl = (string) => {
  let url;

  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
};

const getWordsCount = (text) => {
  const str = text.replace(/<[^>]*>?/gm, "");

  if (str && str.replace(/\s/g, "").length > 10) {
    return getStrWordsCount(str);
  }

  return 0;
};

const detectLang = (text) => {
  const str = text.replace(/<[^>]*>?/gm, "");

  if (str && str.replace(/\s/g, "").length > 10) {
    return lngDetector.detect(str);
  }

  return [];
};

const requireConfig = (name) => {
  const path = `./${name}.config.json`;

  if (fs.existsSync(path)) {
    return require(path);
  }

  const envVarName = `CONFIG_${name}`.toUpperCase();

  const config = JSON.parse(process.env[envVarName] || "null");

  if (!config) {
    throw new Error(`Env var "${envVarName}" does not found.`);
  }

  return config;
};

module.exports = {
  parseTgUrl,
  convertToFullNumber,
  convertTimeToSeconds,
  isValidHttpUrl,
  getWordsCount,
  detectLang,
  requireConfig,
};
