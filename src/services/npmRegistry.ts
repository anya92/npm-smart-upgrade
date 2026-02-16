export interface NpmPackageInfo {
  latest: string;
  versions: string[];
}

export async function fetchPackageInfo(name: string): Promise<NpmPackageInfo> {
  const response = await fetch(`https://registry.npmjs.org/${name}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${name} from npm registry`);
  }
  const data = await response.json();
  return {
    latest: data["dist-tags"].latest as string,
    versions: Object.keys(data.versions as Record<string, unknown>)
  };
}
