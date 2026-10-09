import { author, repository } from "../../package.json";

export const projectName = "LiveMD";
export const maintainer = author;
export const repositoryUrl = repository.url.replace(/\.git$/, "");
export const releasesUrl = `${repositoryUrl}/releases`;
export const latestReleaseApi = `https://api.github.com/repos/${new URL(repositoryUrl).pathname.slice(1)}/releases/latest`;
