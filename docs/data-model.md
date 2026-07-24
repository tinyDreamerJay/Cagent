# 鏁版嵁妯″瀷

## 鍓嶇鐘舵€?
### Message

鑱婂ぉ娑堟伅鐨勬牳蹇冩暟鎹粨鏋勶細

```typescript
interface Message {
  id: string;           // 鍞竴鏍囪瘑锛?msg-{timestamp}" 鎴?"streaming"锛?  role: "user" | "assistant" | "error";
  text: string;         // 娑堟伅鏂囨湰锛圡arkdown 鏍煎紡锛?  toolCalls?: ToolCall[]; // 鍏宠仈鐨勫伐鍏疯皟鐢?}
```

### ToolCall

宸ュ叿璋冪敤鐨勫睍绀烘暟鎹粨鏋勶細

```typescript
interface ToolCall {
  id: string;           // 鍞竴鏍囪瘑锛?tool-{timestamp}"锛?  name: string;         // 宸ュ叿鍚嶏紙read/write/edit/bash锛?  params: string;       // 璋冪敤鍙傛暟锛圝SON 瀛楃涓诧級
  result?: string;      // 璋冪敤缁撴灉锛堟埅鏂悗锛?  collapsed: boolean;   // 鏄惁鎶樺彔
}
```

### 娑堟伅鐢熷懡鍛ㄦ湡

1. 鐢ㄦ埛鍙戦€?鈫?`{ id: "msg-...", role: "user", text }`
2. 鏀跺埌绗竴涓?token 鈫?`{ id: "streaming", role: "assistant", text: "" }`
3. 鎸佺画鏀跺埌 token 鈫?鏇存柊 `text` 瀛楁锛堢疮鍔狅級
4. 鏀跺埌 `message:done` 鈫?`id` 浠?`"streaming"` 鏀逛负 `"msg-{timestamp}"`
5. 鏀跺埌 `error` 鈫?`{ id: "err-...", role: "error", text: "鉂?..." }`

## WebSocket 娑堟伅鏍煎紡

鎵€鏈夋秷鎭潎涓?JSON锛?
```typescript
// 閫氱敤鏍煎紡
{
  type: string;    // 娑堟伅绫诲瀷鏍囪瘑
  payload: any;    // 娑堟伅璐熻浇
}
```

### 瀹㈡埛绔彂閫侊紙涓婅锛?
| type | payload 缁撴瀯 |
|------|-------------|
| `session:init` | `{}` |
| `session:prompt` | `{ text: string, model?: string }` |
| `session:abort` | `{}` |
| `auth:set-key` | `{ provider: string, apiKey: string }` |
| `auth:providers` | `{}` |
| `session:list` | `{}` |

### 鏈嶅姟绔彂閫侊紙涓嬭锛?
| type | payload 缁撴瀯 |
|------|-------------|
| `session:ready` | `{}` |
| `status` | `{ message: string }` |
| `token` | `{ text: string }` |
| `message:user` | `{ text: string }` |
| `message:done` | `{}` |
| `message:aborted` | `{}` |
| `tool:call` | `{ name: string, params: string }` |
| `tool:result` | `{ name: string, output: string }` |
| `auth:key-ready` | `{ provider: string, models?: string[] }` |
| `auth:providers` | `string[]` |
| `error` | `{ message: string }` |

## 鏈嶅姟绔姸鎬?
### CagentSession锛坰erver/src/session.ts锛?
```typescript
class CagentSession {
  id: string;                         // 浼氳瘽 ID
  sessionManager: SessionManager;      // pi SDK 浼氳瘽绠＄悊鍣紙鍐呭瓨锛?  modelRuntime: ModelRuntime;          // pi SDK 妯″瀷杩愯鏃?  abortController: AbortController;    // 涓鎺у埗鍣?}
```

### 宓屽叆寮?Server锛坋lectron/server.cjs锛?
鏃?class 灏佽锛屼娇鐢ㄦā鍧楃骇鍙橀噺锛?
```javascript
let sessionManager = null;   // pi.SessionManager 瀹炰緥
let modelRuntime = null;     // pi.ModelRuntime 瀹炰緥
let abortCtrl = null;        // AbortController
```

## 鎸佷箙鍖栨暟鎹?
| 鏁版嵁 | 瀛樺偍浣嶇疆 | 鏍煎紡 |
|------|----------|------|
| API Key | `localStorage`锛坘ey: `cagent_apikey`锛?| 绾枃鏈瓧绗︿覆 |
| 鍓嶇鏋勫缓浜х墿 | `client/dist/` | 闈欐€佹枃浠讹紙HTML/JS/CSS锛?|
| asar 鎵撳寘 | `release/win-unpacked/resources/app.asar` | Electron asar 褰掓。 |

## Workspace 状态

`WorkspaceApproval` 仅包含主进程生成的一次性 `id`、动作类型和摘要。renderer 只能发送 `approve({ id })` 或 `deny({ id })`，未知或重放 id 必须失败。终端状态包括 `cwd`、`branch`、`terminalRunning` 和输出事件；终端由主进程持有持久 `cmd.exe` 会话，支持 start/write/kill，标准输入输出不提供完整 PTY resize。

