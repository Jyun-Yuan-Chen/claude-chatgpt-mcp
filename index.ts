#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { runAppleScript } from 'run-applescript';
import { run } from '@jxa/run';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 獲取當前檔案的目錄路徑
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFilePath = path.join(__dirname, 'log.txt');

// 自定義日誌函數，只將訊息寫入檔案而不輸出到標準輸出（避免破壞 JSON 協議）
function logMessage(message: string, isError = false): void {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  
  // 寫入日誌檔案
  fs.appendFileSync(logFilePath, logEntry);
  
  // 不再使用標準輸出，避免干擾 MCP 協議
  // 如果需要本地除錯，請使用其他渠道如檔案或系統日誌
}

// 定義 ChatGPT 工具
// 這個工具允許透過 MCP 協議與 macOS 上的 ChatGPT 桌面應用程式互動
const CHATGPT_TOOL: Tool = {
  name: "chatgpt",
  description: "Interact with the ChatGPT desktop app on macOS", // 與 macOS 上的 ChatGPT 桌面應用程式互動
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "Operation to perform: 'ask' or 'get_conversations'", // 要執行的操作：「詢問」或「獲取對話」
        enum: ["ask", "get_conversations"]
      },
      prompt: {
        type: "string",
        description: "The prompt to send to ChatGPT (required for ask operation)" // 發送給 ChatGPT 的提示（詢問操作時必需）
      },
      conversation_id: {
        type: "string",
        description: "Optional conversation ID to continue a specific conversation" // 可選的對話 ID，用於繼續特定對話
      }
    },
    required: ["operation"]
  }
};

// 建立 MCP 伺服器實例
const server = new Server(
  {
    name: "ChatGPT MCP Tool",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 檢查 ChatGPT 應用程式是否已安裝並正在運行
async function checkChatGPTAccess(): Promise<boolean> {
  try {
    // 使用 AppleScript 檢查 ChatGPT 進程是否存在
    const isRunning = await runAppleScript(`
      tell application "System Events"
        return application process "ChatGPT" exists
      end tell
    `);

    if (isRunning !== "true") {
      logMessage("ChatGPT 應用程式尚未執行，嘗試啟動中...");
      try {
        // 啟動 ChatGPT 應用程式
        await runAppleScript(`
          tell application "ChatGPT" to activate
          delay 2
        `);
      } catch (activateError) {
        logMessage("啟動 ChatGPT 應用程式時發生錯誤: " + activateError, true);
        throw new Error("無法啟動 ChatGPT 應用程式。請手動啟動。");
      }
    }
    
    return true;
  } catch (error) {
    logMessage("ChatGPT 訪問檢查失敗: " + error, true);
    throw new Error(
      `無法訪問 ChatGPT 應用程式。請確保 ChatGPT 已安裝並正確配置。錯誤: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// 發送提示給 ChatGPT 的函數
async function askChatGPT(prompt: string, conversationId?: string): Promise<string> {
  await checkChatGPTAccess();
  
  try {
    logMessage("開始向 ChatGPT 發送提示：" + prompt.substring(0, 50) + (prompt.length > 50 ? "..." : ""));
    
    // 使用極簡的 AppleScript 方法來與 ChatGPT 互動
    // 不再依賴特定的 UI 元素結構，僅使用基本的窗口互動和熱鍵
    const result = await runAppleScript(`
      tell application "ChatGPT"
        activate
        delay 2
      end tell
      
      tell application "System Events"
        -- 將提示文字複製到剪貼板
        set the clipboard to "${prompt.replace(/"/g, '\\"')}"
        
        -- 確保 ChatGPT 是前台應用程式
        tell application process "ChatGPT"
          -- 按 Cmd+N 嘗試開始新對話（如果需要）
          -- key code 45 using {command down}  -- 註釋掉，防止意外創建新對話
          delay 1
          
          -- 點擊窗口底部區域（通常是輸入區）
          set windowSize to size of window 1
          set windowPos to position of window 1
          
          -- 計算窗口底部中間位置（通常是輸入框）
          set clickX to (item 1 of windowPos) + ((item 1 of windowSize) / 2)
          set clickY to (item 2 of windowPos) + (item 2 of windowSize) - 50
          
          -- 點擊輸入區域
          click at {clickX, clickY}
          delay 1
          
          -- 嘗試清空可能存在的舊文字 (Cmd+A 全選後刪除)
          key code 0 using {command down}  -- Cmd+A
          delay 0.5
          key code 51  -- Delete 鍵
          delay 0.5
          
          -- 貼上提示文字
          key code 9 using {command down}  -- Cmd+V
          delay 0.5
          
          -- 發送提示 (按回車鍵)
          key code 36  -- Return 鍵
          
          -- 等待 ChatGPT 生成回應
          delay 10
          
          -- 使用截圖的方法來獲取回應
          -- 我們將截取整個 ChatGPT 窗口，稍後可以根據需要提取文本
          set response to "ChatGPT 已處理您的請求。由於 UI 結構限制，無法直接擷取回應文本。請查看 ChatGPT 應用程式中的回應。"
          return response
        end tell
      end tell
    `);
    
    logMessage("與 ChatGPT 互動完成");
    return result;
  } catch (error) {
    logMessage("與 ChatGPT 互動時發生錯誤: " + error, true);
    throw new Error(`無法從 ChatGPT 獲取回應: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 獲取可用對話的函數
async function getConversations(): Promise<string[]> {
  await checkChatGPTAccess();
  
  try {
    const result = await runAppleScript(`
      tell application "ChatGPT"
        activate
        delay 1
        
        tell application "System Events"
          tell process "ChatGPT"
            -- 嘗試獲取對話標題
            set conversationsList to {}
            
            try
              set chatButtons to buttons of group 1 of group 1 of window 1
              repeat with chatButton in chatButtons
                set buttonName to name of chatButton
                if buttonName is not "New chat" then
                  set end of conversationsList to buttonName
                end if
              end repeat
            on error
              set conversationsList to {"無法獲取對話"}
            end try
            
            return conversationsList
          end tell
        end tell
      end tell
    `);
    
    // 將 AppleScript 結果解析為數組
    const conversations = result.split(", ");
    return conversations;
  } catch (error) {
    logMessage("獲取 ChatGPT 對話時發生錯誤: " + error, true);
    return ["獲取對話時發生錯誤"];
  }
}

// 檢查是否為 ChatGPT 的有效參數
function isChatGPTArgs(args: unknown): args is {
  operation: "ask" | "get_conversations";
  prompt?: string;
  conversation_id?: string;
} {
  if (typeof args !== "object" || args === null) return false;
  
  const { operation, prompt, conversation_id } = args as any;
  
  if (!operation || !["ask", "get_conversations"].includes(operation)) {
    return false;
  }
  
  // 根據操作驗證必需字段
  if (operation === "ask" && !prompt) return false;
  
  // 驗證字段類型（如果存在）
  if (prompt && typeof prompt !== "string") return false;
  if (conversation_id && typeof conversation_id !== "string") return false;
  
  return true;
}

// 設置工具列表請求處理器
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [CHATGPT_TOOL],
}));

// 設置工具調用請求處理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("未提供參數");
    }

    if (name === "chatgpt") {
      if (!isChatGPTArgs(args)) {
        throw new Error("ChatGPT 工具的參數無效");
      }

      switch (args.operation) {
        case "ask": {
          if (!args.prompt) {
            throw new Error("詢問操作需要提供提示");
          }
          
          const response = await askChatGPT(args.prompt, args.conversation_id);
          
          return {
            content: [{ 
              type: "text", 
              text: response || "未收到 ChatGPT 的回應。"
            }],
            isError: false
          };
        }

        case "get_conversations": {
          const conversations = await getConversations();
          
          return {
            content: [{ 
              type: "text", 
              text: conversations.length > 0 ? 
                `找到 ${conversations.length} 個對話:\n\n${conversations.join("\n")}` :
                "ChatGPT 中未找到任何對話。"
            }],
            isError: false
          };
        }

        default:
          throw new Error(`未知操作: ${args.operation}`);
      }
    }

    return {
      content: [{ type: "text", text: `未知工具: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `錯誤: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// 建立標準輸入輸出伺服器傳輸
const transport = new StdioServerTransport();
await server.connect(transport);
logMessage("ChatGPT MCP 伺服器正在標準輸入輸出上運行");