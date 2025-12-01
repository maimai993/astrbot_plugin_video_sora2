import asyncio
import json
import logging
from typing import Dict, Set, List
from datetime import datetime
from astrbot.api import logger

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    logger.warning("websockets模块未安装，自动获取Token功能将不可用")


class TokenWebSocketServer:
    """WebSocket服务器用于接收自动上报的ChatGPT AccessToken"""
    
    def __init__(self, port: int = 5103):
        self.port = port
        self.connected_clients: Set[WebSocketServerProtocol] = set()
        self.tokens: Dict[str, dict] = {}  # token -> token_data
        self.server = None
        self.is_running = False
        
    async def start(self):
        """启动WebSocket服务器"""
        if not WEBSOCKETS_AVAILABLE:
            logger.error("无法启动WebSocket服务器：websockets模块未安装")
            return False
            
        try:
            self.server = await websockets.serve(
                self.handle_client,
                "localhost",
                self.port
            )
            self.is_running = True
            logger.info(f"✅ WebSocket服务器已启动，监听端口: {self.port}")
            return True
        except Exception as e:
            logger.error(f"❌ 启动WebSocket服务器失败: {e}")
            return False
    
    async def stop(self):
        """停止WebSocket服务器"""
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            self.is_running = False
            logger.info("✅ WebSocket服务器已停止")
    
    async def handle_client(self, websocket: WebSocketServerProtocol, path: str):
        """处理客户端连接"""
        client_id = id(websocket)
        logger.info(f"🔗 客户端已连接: {client_id}")
        self.connected_clients.add(websocket)
        
        try:
            async for message in websocket:
                await self.handle_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"🔌 客户端断开连接: {client_id}")
        finally:
            self.connected_clients.remove(websocket)
    
    async def handle_message(self, websocket: WebSocketServerProtocol, message: str):
        """处理接收到的消息"""
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "connection":
                # 客户端连接确认
                logger.info(f"📡 客户端连接确认: {data.get('client', 'unknown')}")
                # 发送欢迎消息
                await self.send_message(websocket, {
                    "type": "welcome",
                    "message": "WebSocket服务器连接成功",
                    "timestamp": datetime.now().isoformat(),
                    "server_version": "1.0.0"
                })
                
            elif msg_type == "token_update":
                # Token更新消息
                await self.handle_token_update(data)
                
            elif msg_type == "token_error":
                # Token错误消息
                await self.handle_token_error(data)
                
            elif msg_type == "heartbeat":
                # 心跳消息
                await self.send_message(websocket, {
                    "type": "pong",
                    "timestamp": datetime.now().isoformat()
                })
                
            elif msg_type == "pong":
                # 心跳响应
                pass
                
            else:
                logger.warning(f"⚠️ 未知消息类型: {msg_type}")
                
        except json.JSONDecodeError as e:
            logger.error(f"❌ 消息解析失败: {e}")
        except Exception as e:
            logger.error(f"❌ 处理消息时发生错误: {e}")
    
    async def handle_token_update(self, data: dict):
        """处理Token更新"""
        access_token = data.get("accessToken")
        if not access_token:
            logger.warning("⚠️ 收到的Token更新消息中没有accessToken字段")
            return
        
        user_info = data.get("user", {})
        user_name = user_info.get("name", "unknown")
        user_email = user_info.get("email", "unknown")
        
        # 存储Token信息
        self.tokens[access_token] = {
            "token": access_token,
            "user_name": user_name,
            "user_email": user_email,
            "expires": data.get("expires"),
            "status": data.get("status", "active"),
            "last_updated": datetime.now().isoformat(),
            "raw_data": data  # 保存原始数据以供调试
        }
        
        logger.info(f"✅ 收到Token更新: {user_name} ({user_email})")
        logger.info(f"🔑 Token长度: {len(access_token)}")
        logger.info(f"📊 当前Token数量: {len(self.tokens)}")
        
        # 广播给所有客户端（如果需要）
        await self.broadcast({
            "type": "token_received",
            "user": user_name,
            "timestamp": datetime.now().isoformat(),
            "total_tokens": len(self.tokens)
        })
    
    async def handle_token_error(self, data: dict):
        """处理Token错误"""
        error_msg = data.get("error", "未知错误")
        status = data.get("status", "unknown")
        
        logger.warning(f"⚠️ Token错误: {error_msg} (状态: {status})")
        
        # 可以在这里处理登录过期等错误
        
    async def send_message(self, websocket: WebSocketServerProtocol, message: dict):
        """发送消息给指定客户端"""
        try:
            await websocket.send(json.dumps(message))
        except Exception as e:
            logger.error(f"❌ 发送消息失败: {e}")
    
    async def broadcast(self, message: dict):
        """广播消息给所有客户端"""
        if not self.connected_clients:
            return
            
        disconnected = []
        for client in self.connected_clients:
            try:
                await client.send(json.dumps(message))
            except Exception:
                disconnected.append(client)
        
        # 移除断开连接的客户端
        for client in disconnected:
            self.connected_clients.remove(client)
    
    def get_tokens(self) -> List[str]:
        """获取所有Token列表"""
        return list(self.tokens.keys())
    
    def get_token_info(self, token: str) -> dict:
        """获取指定Token的详细信息"""
        return self.tokens.get(token, {})
    
    def get_all_token_info(self) -> List[dict]:
        """获取所有Token的详细信息"""
        return list(self.tokens.values())
    
    def remove_token(self, token: str) -> bool:
        """移除指定的Token"""
        if token in self.tokens:
            del self.tokens[token]
            logger.info(f"🗑️ 已移除Token: {token[:8]}...")
            return True
        return False
    
    def clear_tokens(self):
        """清空所有Token"""
        count = len(self.tokens)
        self.tokens.clear()
        logger.info(f"🗑️ 已清空所有Token，共{count}个")
    
    async def request_token_refresh(self):
        """请求所有客户端刷新Token"""
        await self.broadcast({
            "type": "request_token",
            "message": "服务器请求刷新Token",
            "timestamp": datetime.now().isoformat()
        })
        logger.info("🔄 已发送Token刷新请求")


# 全局WebSocket服务器实例
_global_websocket_server: TokenWebSocketServer = None


def get_websocket_server(port: int = 5103) -> TokenWebSocketServer:
    """获取全局WebSocket服务器实例"""
    global _global_websocket_server
    if _global_websocket_server is None:
        _global_websocket_server = TokenWebSocketServer(port)
    return _global_websocket_server


async def start_websocket_server(port: int = 5103) -> bool:
    """启动WebSocket服务器"""
    server = get_websocket_server(port)
    return await server.start()


async def stop_websocket_server():
    """停止WebSocket服务器"""
    global _global_websocket_server
    if _global_websocket_server:
        await _global_websocket_server.stop()
        _global_websocket_server = None


def is_websocket_server_running() -> bool:
    """检查WebSocket服务器是否正在运行"""
    global _global_websocket_server
    return _global_websocket_server is not None and _global_websocket_server.is_running


def get_auto_tokens() -> List[str]:
    """获取自动获取的Token列表"""
    global _global_websocket_server
    if _global_websocket_server:
        return _global_websocket_server.get_tokens()
    return []


def get_auto_token_info() -> List[dict]:
    """获取自动获取的Token详细信息"""
    global _global_websocket_server
    if _global_websocket_server:
        return _global_websocket_server.get_all_token_info()
    return []


async def refresh_auto_tokens():
    """请求刷新自动获取的Token"""
    global _global_websocket_server
    if _global_websocket_server:
        await _global_websocket_server.request_token_refresh()
