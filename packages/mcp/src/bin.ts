#!/usr/bin/env node
/**
 * @karax/mcp 실행 파일
 * npx @karax/mcp 로 실행 가능
 */
import { startStdioServer } from "./server.js";

startStdioServer().catch((err) => {
  console.error("[karax/mcp] 서버 시작 실패:", err);
  process.exit(1);
});
