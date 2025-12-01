// ==UserScript==
// @name         ChatGPT AccessToken WebSocket 上报 (修复CSP版本)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  提取accessToken并通过WebSocket上报到 ws://localhost:5103/ws (修复CSP问题)
// @author       maimai
// @match        https://chatgpt.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    
    // 配置
    const WS_URL = 'ws://localhost:5103/ws';
    const REFRESH_INTERVAL = 10 * 60 * 1000; // 10分钟
    const RETRY_INTERVAL = 5000; // 重试间隔
    let ws = null;
    let isConnected = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    let heartbeatInterval = null;
    let refreshTimer = null;

    // 1. WebSocket 连接管理
    function connectWebSocket() {
        console.log('[Token WS] 🔗 正在连接WebSocket服务器...');
        
        try {
            ws = new WebSocket(WS_URL);
            
            ws.onopen = function(event) {
                console.log('[Token WS] ✅ WebSocket连接成功');
                isConnected = true;
                reconnectAttempts = 0;
                
                // 发送连接确认
                sendMessage({
                    type: 'connection',
                    status: 'connected',
                    client: 'chatgpt_token_extractor',
                    timestamp: new Date().toISOString()
                });
                
                // 开始心跳
                startHeartbeat();
                
                // 立即提取并发送Token
                extractAndSendToken();
                
                // 设置定时刷新
                startRefreshTimer();
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    console.log('[Token WS] 📨 收到服务器消息:', data);
                    
                    // 处理服务器指令
                    if (data.type === 'ping') {
                        sendMessage({ type: 'pong', timestamp: new Date().toISOString() });
                    } else if (data.type === 'request_token') {
                        console.log('[Token WS] 🔄 服务器请求Token，立即提取...');
                        extractAndSendToken();
                    } else if (data.type === 'status') {
                        console.log('[Token WS] 📊 服务器状态:', data.status);
                    }
                } catch (e) {
                    console.log('[Token WS] ⚠️ 消息解析失败:', e);
                }
            };
            
            ws.onerror = function(error) {
                console.log('[Token WS] ❌ WebSocket错误:', error);
                isConnected = false;
                
                // 显示详细的错误信息
                if (error && error.message) {
                    console.log('[Token WS] 🔍 错误详情:', error.message);
                }
                
                // 检查是否是CSP错误
                if (error && (error.message && error.message.includes('CSP') || 
                    error.message && error.message.includes('Content Security Policy'))) {
                    console.log('[Token WS] ⚠️ 检测到CSP错误，尝试备用方案...');
                    showCSPWarning();
                }
            };
            
            ws.onclose = function(event) {
                console.log(`[Token WS] 🔌 连接断开，代码: ${event.code}, 原因: ${event.reason}`);
                isConnected = false;
                stopHeartbeat();
                stopRefreshTimer();
                
                // 自动重连
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(`[Token WS] 🔄 ${RETRY_INTERVAL/1000}秒后重试 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(connectWebSocket, RETRY_INTERVAL);
                } else {
                    console.log('[Token WS] ❌ 达到最大重试次数，停止重连');
                    GM_notification({
                        title: 'WebSocket连接失败',
                        text: '无法连接到服务器，请检查服务器是否运行',
                        timeout: 5000
                    });
                }
            };
            
        } catch (error) {
            console.log('[Token WS] ❌ 创建WebSocket失败:', error);
            
            // 如果是CSP错误，提供解决方案
            if (error.message && error.message.includes('Content Security Policy')) {
                console.log('[Token WS] ⚠️ CSP阻止了WebSocket连接');
                console.log('[Token WS] 💡 解决方案:');
                console.log('[Token WS]   1. 确保Tampermonkey已启用');
                console.log('[Token WS]   2. 检查脚本是否有@connect localhost权限');
                console.log('[Token WS]   3. 尝试重启浏览器');
                showCSPWarning();
            }
            
            setTimeout(connectWebSocket, RETRY_INTERVAL);
        }
    }

    // 2. 发送消息
    function sendMessage(data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log('[Token WS] ⚠️ WebSocket未连接，无法发送消息');
            return false;
        }
        
        try {
            ws.send(JSON.stringify(data));
            return true;
        } catch (error) {
            console.log('[Token WS] ❌ 发送消息失败:', error);
            return false;
        }
    }

    // 3. 心跳机制
    function startHeartbeat() {
        stopHeartbeat(); // 先停止已有的
    
        heartbeatInterval = setInterval(() => {
            if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
                sendMessage({ 
                    type: 'heartbeat', 
                    timestamp: new Date().toISOString() 
                });
            }
        }, 30000); // 30秒一次心跳
    }

    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }

    // 4. 定时刷新
    function startRefreshTimer() {
        stopRefreshTimer(); // 先停止已有的
        
        refreshTimer = setInterval(() => {
            console.log('[Token WS] ⏰ 10分钟定时刷新，重新获取Token...');
            GM_notification({
                title: '定时刷新',
                text: '10分钟到期，重新获取Token',
                timeout: 3000
            });
            location.reload();
        }, REFRESH_INTERVAL);
    }

    function stopRefreshTimer() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    // 5. 提取并发送Token
    function extractAndSendToken() {
        console.log('[Token WS] 🔍 开始提取Token...');
        
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://chatgpt.com/api/auth/session',
            timeout: 10000, // 10秒超时
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    
                    if (data && data.accessToken && data.user) {
                        // 准备Token数据
                        const tokenData = {
                            type: 'token_update',
                            timestamp: new Date().toISOString(),
                            accessToken: data.accessToken,
                            user: {
                                id: data.user.id,
                                name: data.user.name,
                                email: data.user.email
                            },
                            account: data.account,
                            expires: data.expires,
                            status: 'active'
                        };
                        
                        // 发送到WebSocket服务器
                        const sent = sendMessage(tokenData);
                        
                        if (sent) {
                            console.log('[Token WS] ✅ Token已成功发送到服务器');
                            console.log('[Token WS] 👤 用户:', data.user.name);
                            console.log('[Token WS] 📧 邮箱:', data.user.email);
                            console.log('[Token WS] 🔑 Token长度:', data.accessToken.length);
                            console.log('[Token WS] ⏰ 过期时间:', data.expires);
                            
                            // 显示成功通知
                            showSuccessNotification(data.user.name, data.accessToken.length);
                        } else {
                            console.log('[Token WS] ❌ Token发送失败');
                        }
                        
                    } else {
                        handleNoToken('会话数据中未找到Token或用户信息');
                    }
                } catch (e) {
                    handleNoToken('解析会话数据失败: ' + e.message);
                }
            },
            onerror: function(error) {
                handleNoToken('请求会话接口失败: ' + error.statusText);
            },
            ontimeout: function() {
                handleNoToken('请求会话接口超时');
            }
        });
    }

    // 6. 处理无Token情况
    function handleNoToken(reason) {
        console.log('[Token WS] ⚠️ Token获取失败:', reason);
        
        const errorData = {
            type: 'token_error',
            timestamp: new Date().toISOString(),
            error: reason,
            status: 'login_expired'
        };
        
        // 发送错误信息到服务器
        sendMessage(errorData);
        
        // 显示错误通知
        GM_notification({
            title: '❌ 登录过期',
            text: reason,
            timeout: 5000
        });
        
        // 10秒后重试
        setTimeout(extractAndSendToken, 10000);
    }

    // 7. 显示成功通知
    function showSuccessNotification(username, tokenLength) {
        GM_notification({
            title: '✅ Token获取成功',
            text: `用户: ${username} | Token长度: ${tokenLength}`,
            timeout: 4000
        });
        
        // 在控制台显示详细信息
        console.log('[Token WS] 🎉 Token上报成功!');
        console.log('[Token WS] 📊 下一次刷新: 10分钟后');
        console.log('[Token WS] 🔄 自动刷新倒计时已启动');
    }

    // 8. 显示CSP警告
    function showCSPWarning() {
        console.log('[Token WS] ⚠️ ⚠️ ⚠️ 重要: CSP阻止了WebSocket连接');
        console.log('[Token WS] 💡 解决方案:');
        console.log('[Token WS]   1. 确保Tampermonkey已启用');
        console.log('[Token WS]   2. 检查脚本是否有@connect localhost权限');
        console.log('[Token WS]   3. 在Tampermonkey设置中启用"允许访问本地文件"');
        console.log('[Token WS]   4. 尝试使用备用方案:');
        console.log('[Token WS]      - 使用HTTP代理替代WebSocket');
        console.log('[Token WS]      - 修改浏览器CSP设置（不推荐）');
        
        GM_notification({
            title: '⚠️ CSP警告',
            text: '内容安全策略阻止了WebSocket连接，请检查Tampermonkey设置',
            timeout: 8000
        });
    }

    // 9. 页面控制台命令
    function setupConsoleCommands() {
        unsafeWindow.tokenWS = {
            // 手动提取并发送Token
            refreshToken: function() {
                console.log('[Token WS] 🔄 手动刷新Token...');
                extractAndSendToken();
            },
            
            // 检查连接状态
            status: function() {
                return {
                    connected: isConnected,
                    wsReadyState: ws ? ws.readyState : 'no_connection',
                    reconnectAttempts: reconnectAttempts,
                    nextRefresh: refreshTimer ? 'active' : 'inactive',
                    serverUrl: WS_URL
                };
            },
            
            // 手动重连
            reconnect: function() {
                console.log('[Token WS] 🔗 手动重连WebSocket...');
                reconnectAttempts = 0;
                connectWebSocket();
            },
            
            // 手动刷新页面
            reloadPage: function() {
                console.log('[Token WS] 🔄 手动刷新页面...');
                location.reload();
            },
            
            // 诊断CSP问题
            diagnoseCSP: function() {
                console.log('[Token WS] 🔍 诊断CSP问题...');
                console.log('[Token WS] 当前URL:', window.location.href);
                console.log('[Token WS] Tampermonkey版本:', GM_info ? GM_info.version : '未知');
                console.log('[Token WS] 脚本权限:', GM_info ? GM_info.script.grants : '未知');
                
                // 测试WebSocket连接
                try {
                    const testWs = new WebSocket('ws://localhost:5103/ws');
                    testWs.onerror = function(e) {
                        console.log('[Token WS] ❌ WebSocket测试失败:', e);
                    };
                    testWs.onopen = function() {
                        console.log('[Token WS] ✅ WebSocket测试成功');
                        testWs.close();
                    };
                    setTimeout(() => {
                        if (testWs.readyState !== WebSocket.OPEN) {
                            console.log('[Token WS] ⏱️ WebSocket测试超时');
                        }
                    }, 2000);
                } catch (e) {
                    console.log('[Token WS] ❌ 创建WebSocket测试失败:', e);
                }
            }
        };
        
        console.log('[Token WS] 🎮 控制台命令已启用:');
        console.log('   tokenWS.refreshToken() - 手动刷新Token');
        console.log('   tokenWS.status() - 查看连接状态');
        console.log('   tokenWS.reconnect() - 手动重连');
        console.log('   tokenWS.reloadPage() - 手动刷新页面');
        console.log('   tokenWS.diagnoseCSP() - 诊断CSP问题');
    }

    // 10. 主函数
    function main() {
        console.clear();
        console.log('══════════════════════════════════════════════════════════');
        console.log('   ChatGPT Token WebSocket 上报服务 v1.1 (修复CSP)      ');
        console.log('══════════════════════════════════════════════════════════');
        console.log('');
        console.log('🌐 WebSocket服务器:', WS_URL);
        console.log('⏰ 自动刷新间隔: 10分钟');
        console.log('🔧 已添加@connect localhost权限');
        console.log('');
        console.log('📡 工作流程:');
        console.log('   1. 连接WebSocket服务器');
        console.log('   2. 自动提取Token并上报');
        console.log('   3. 保持心跳连接');
        console.log('   4. 10分钟后自动刷新重新获取');
        console.log('   5. 获取失败上报"登录过期"');
        console.log('');
        console.log('🚀 正在启动服务...');
        console.log('══════════════════════════════════════════════════════════');
        
        // 设置控制台命令
        setupConsoleCommands();
        
        // 连接WebSocket
        setTimeout(connectWebSocket, 1000);
    }

    // 11. 页面卸载清理
    window.addEventListener('beforeunload', function() {
        console.log('[Token WS] 🧹 页面卸载，清理资源...');
        stopHeartbeat();
        stopRefreshTimer();
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendMessage({ 
                type: 'disconnect', 
                reason: 'page_unload',
                timestamp: new Date().toISOString() 
            });
            ws.close(1000, '正常关闭');
        }
    });

    // 启动服务
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();
