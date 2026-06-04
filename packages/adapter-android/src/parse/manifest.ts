/**
 * AndroidManifest.xml 파서
 *
 * LAUNCHER Activity를 찾아 MainActivity의 클래스명을 반환한다.
 */

import { readFile, access } from "fs/promises";
import path from "path";

export interface ManifestResult {
  packageName: string;
  launcherActivity: string | undefined;
}

/** XML에서 특정 attribute 값을 추출하는 미니 파서 */
function extractAttr(xml: string, attr: string): string | undefined {
  const re = new RegExp(`${attr}="([^"]+)"`, "g");
  const m = re.exec(xml);
  return m ? m[1] : undefined;
}

/** LAUNCHER intent-filter를 가진 activity의 android:name을 찾는다 */
function parseLauncherActivity(xml: string): string | undefined {
  // <activity android:name="..." ...> ... LAUNCHER ... </activity> 패턴
  // 단순 정규식 기반 파싱 (XML DOM 라이브러리 없이)
  const activityRegex = /<activity\b([^>]*(?:>(?:[^<]*<(?!\/activity)[^>]*>)*[^<]*))(?:(?:[^<]|<(?!\/activity>))*?)/gs;

  // 방법: activity 블록 전체를 추출하고 LAUNCHER가 포함된 것 찾기
  // <activity ...> ... </activity> 블록 추출
  const activityBlockRegex = /<activity\b([\s\S]*?)<\/activity>/g;
  let m: RegExpExecArray | null;

  while ((m = activityBlockRegex.exec(xml)) !== null) {
    const block = m[0]!;
    if (block.includes("android.intent.category.LAUNCHER")) {
      // android:name 추출
      const nameMatch = /android:name="([^"]+)"/.exec(block);
      if (nameMatch) {
        let name = nameMatch[1]!;
        // ".MainActivity" → "MainActivity" (상대 경로 처리)
        if (name.startsWith(".")) name = name.slice(1);
        // com.example.fixture.MainActivity → MainActivity
        const parts = name.split(".");
        return parts[parts.length - 1]!;
      }
    }
  }

  return undefined;
}

export async function parseManifest(
  projectPath: string
): Promise<ManifestResult> {
  const manifestPath = path.join(
    projectPath,
    "app",
    "src",
    "main",
    "AndroidManifest.xml"
  );

  let xml: string;
  try {
    xml = await readFile(manifestPath, "utf-8");
  } catch {
    return { packageName: "", launcherActivity: undefined };
  }

  const packageName = extractAttr(xml, "package") ?? "";
  const launcherActivity = parseLauncherActivity(xml);

  return { packageName, launcherActivity };
}

/** settings.gradle(.kts)에서 rootProject.name을 추출한다 */
export async function readProjectName(
  projectPath: string
): Promise<string | undefined> {
  for (const fname of ["settings.gradle.kts", "settings.gradle"]) {
    const fpath = path.join(projectPath, fname);
    try {
      await access(fpath);
      const content = await readFile(fpath, "utf-8");
      const m = /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(content);
      if (m) return m[1];
    } catch {
      // 파일 없으면 건너뜀
    }
  }
  return undefined;
}
