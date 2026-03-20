// ================= 配置常量 =================
const BOARD_SIZE = 8;
const CELL_SIZE = 50;
const GAP_SIZE = 2;
const TOTAL_STEP = CELL_SIZE + GAP_SIZE;
const WALL_THICKNESS = GAP_SIZE + 4;
const HIT_TOLERANCE = 15;
const ROOM_PREFIX = "qj-"; // 【修复】添加缺失的常量

// ================= 游戏状态 =================
let boardState = [];
let walls = [];
let currentPlayer = 'red';
let gameState = 'PLACE_RED';
let selectedPiecePos = null;
let hoverWall = null;
let lastMousePos = { x: -9999, y: -9999 };

// ================= 联机状态 =================
let peer = null;
let conn = null;
let myRole = null;
let isMultiplayer = false;
let connectionTimeout = null;

// ================= DOM 元素 =================
let boardElement, statusText, modeDisplay, networkStatusEl;

// ================= 页面加载入口 =================
window.onload = function() {
    console.log("🚀 游戏正在启动...");
    
    // 获取 DOM 元素
    boardElement = document.getElementById('board');
    statusText = document.getElementById('status-text');
    modeDisplay = document.getElementById('mode-display');
    networkStatusEl = document.getElementById('network-status');
    
    // 检查必要元素
    if (!boardElement) {
        console.error("❌ 找不到 #board 元素");
        document.body.innerHTML += "<div style='color:red;padding:20px;'>错误: 页面缺少棋盘元素</div>";
        return;
    }
    
    // 初始化游戏
    initGame();
    
    // 延迟初始化网络，确保 DOM 完全加载
    setTimeout(initNetwork, 500);
};

// ================= 游戏核心逻辑 =================

function initGame() {
    boardState = [];
    walls = [];
    currentPlayer = 'red';
    gameState = 'PLACE_RED';
    selectedPiecePos = null;
    hoverWall = null;
    lastMousePos = { x: -9999, y: -9999 };

    for (let r = 0; r < BOARD_SIZE; r++) {
        let row = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            row.push({ hasPiece: null });
        }
        boardState.push(row);
    }

    renderBoard();
    updateStatus();

    // 移除旧事件监听，防止重复
    boardElement.replaceWith(boardElement.cloneNode(true));
    boardElement = document.getElementById('board');
    
    boardElement.addEventListener('mousemove', handleGlobalMouseMove);
    boardElement.addEventListener('mouseleave', () => {
        if (hoverWall) clearHoverPreview();
    });
}

function renderBoard() {
    if (!boardElement) return;
    boardElement.innerHTML = '';

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.r = r;
            cell.dataset.c = c;

            if (boardState[r][c].hasPiece) {
                const piece = document.createElement('div');
                piece.className = `piece ${boardState[r][c].hasPiece}`;
                cell.appendChild(piece);
            }

            if (gameState === 'MOVE_TARGET' && selectedPiecePos) {
                if (isValidTarget(selectedPiecePos, {r, c})) {
                    cell.classList.add('highlight');
                }
            }

            cell.addEventListener('click', () => handleCellClick(r, c));
            boardElement.appendChild(cell);
        }
    }

    walls.forEach(w => createWallDOM(w.r, w.c, w.type, false));

    if (hoverWall) {
        createWallDOM(hoverWall.r, hoverWall.c, hoverWall.type, true);
    }
}

function createWallDOM(r, c, type, isPreview) {
    const el = document.createElement('div');
    el.className = `wall ${type === 'h' ? 'horizontal' : 'vertical'}`;
    
    if (isPreview) {
        el.classList.add('wall-preview');
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.title = "点击放置隔板";
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            placeWall(r, c, type);
        });
    } else {
        el.style.pointerEvents = 'none';
    }

    let top, left;
    if (type === 'h') {
        top = (r + 1) * TOTAL_STEP - (WALL_THICKNESS / 2);
        left = c * TOTAL_STEP + (GAP_SIZE / 2);
        el.style.width = `${CELL_SIZE}px`;
        el.style.height = `${WALL_THICKNESS}px`;
    } else {
        top = r * TOTAL_STEP + (GAP_SIZE / 2);
        left = (c + 1) * TOTAL_STEP - (WALL_THICKNESS / 2);
        el.style.height = `${CELL_SIZE}px`;
        el.style.width = `${WALL_THICKNESS}px`;
    }

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    boardElement.appendChild(el);
}

function handleGlobalMouseMove(e) {
    const rect = boardElement.getBoundingClientRect();
    lastMousePos.x = e.clientX - rect.left;
    lastMousePos.y = e.clientY - rect.top;

    if (['PLACE_RED_WALL', 'PLACE_BLUE_WALL', 'WALL_PLACE'].includes(gameState)) {
        detectHoverWall(lastMousePos.x, lastMousePos.y);
    }
}

function handleCellClick(r, c) {
    const cell = boardState[r][c];

    // 【修复】联机模式：如果是对手回合，禁止操作
    if (isMultiplayer && gameState === 'WAITING_OPPONENT') {
        return;
    }

    if (gameState === 'PLACE_RED') {
        if (!cell.hasPiece) {
            boardState[r][c].hasPiece = 'red';
            selectedPiecePos = { r, c };
            gameState = 'PLACE_RED_WALL';
            finishSetupPhase();
            
            // 【修复】联机：通知客人可以开始
            if (isMultiplayer && myRole === 'red') {
                sendMove({ type: 'PIECE_PLACED', r, c, color: 'red' });
            }
        } else { if(!isMultiplayer) alert("此处已有棋子"); }
        return;
    }

    if (gameState === 'PLACE_BLUE') {
        if (!cell.hasPiece) {
            boardState[r][c].hasPiece = 'blue';
            selectedPiecePos = { r, c };
            gameState = 'PLACE_BLUE_WALL';
            finishSetupPhase();
            
            if (isMultiplayer && myRole === 'blue') {
                sendMove({ type: 'PIECE_PLACED', r, c, color: 'blue' });
            }
        } else { if(!isMultiplayer) alert("此处已有棋子"); }
        return;
    }

    if (gameState === 'MOVE_SELECT') {
        if (cell.hasPiece === currentPlayer) {
            selectedPiecePos = { r, c };
            gameState = 'MOVE_TARGET';
            renderBoard();
            updateStatus();
        }
        return;
    }

    if (gameState === 'MOVE_TARGET') {
        if (!selectedPiecePos) return;
        
        if (isValidTarget(selectedPiecePos, { r, c })) {
            const moveData = { type: 'MOVE_PIECE', from: selectedPiecePos, to: { r, c } };

            // 本地执行
            boardState[selectedPiecePos.r][selectedPiecePos.c].hasPiece = null;
            boardState[r][c].hasPiece = currentPlayer;
            selectedPiecePos = { r, c };
            gameState = 'WALL_PLACE';
            renderBoard();
            updateStatus();
            forceDetectAfterMove();
            
            // 联机发送
            if (isMultiplayer) {
                sendMove(moveData);
            }
        }
        return;
    }
}

function finishSetupPhase() {
    renderBoard();
    updateStatus();
    forceDetectAfterMove();
}

function forceDetectAfterMove() {
    if (lastMousePos.x === -9999) return;
    detectHoverWall(lastMousePos.x, lastMousePos.y);
}

function detectHoverWall(mx, my) {
    if (!selectedPiecePos) {
        clearHoverPreview();
        return;
    }

    const pr = selectedPiecePos.r;
    const pc = selectedPiecePos.c;
    const candidates = [];

    if (pr > 0) {
        const yCenter = pr * TOTAL_STEP - WALL_THICKNESS / 2;
        const xStart = pc * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr - 1, c: pc, type: 'h',
            xMin: xStart - HIT_TOLERANCE, xMax: xStart + CELL_SIZE + HIT_TOLERANCE,
            yMin: yCenter - HIT_TOLERANCE, yMax: yCenter + HIT_TOLERANCE
        });
    }
    if (pr < BOARD_SIZE - 1) {
        const yCenter = (pr + 1) * TOTAL_STEP - WALL_THICKNESS / 2;
        const xStart = pc * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr, c: pc, type: 'h',
            xMin: xStart - HIT_TOLERANCE, xMax: xStart + CELL_SIZE + HIT_TOLERANCE,
            yMin: yCenter - HIT_TOLERANCE, yMax: yCenter + HIT_TOLERANCE
        });
    }
    if (pc > 0) {
        const xCenter = pc * TOTAL_STEP - WALL_THICKNESS / 2;
        const yStart = pr * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr, c: pc - 1, type: 'v',
            xMin: xCenter - HIT_TOLERANCE, xMax: xCenter + HIT_TOLERANCE,
            yMin: yStart - HIT_TOLERANCE, yMax: yStart + CELL_SIZE + HIT_TOLERANCE
        });
    }
    if (pc < BOARD_SIZE - 1) {
        const xCenter = (pc + 1) * TOTAL_STEP - WALL_THICKNESS / 2;
        const yStart = pr * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr, c: pc, type: 'v',
            xMin: xCenter - HIT_TOLERANCE, xMax: xCenter + HIT_TOLERANCE,
            yMin: yStart - HIT_TOLERANCE, yMax: yStart + CELL_SIZE + HIT_TOLERANCE
        });
    }

    let best = null;
    let minDist = Infinity;

    for (let cand of candidates) {
        if (mx >= cand.xMin && mx <= cand.xMax && my >= cand.yMin && my <= cand.yMax) {
            const cx = (cand.xMin + cand.xMax) / 2;
            const cy = (cand.yMin + cand.yMax) / 2;
            const dist = Math.sqrt((mx - cx)**2 + (my - cy)**2);

            if (dist < minDist) {
                if (isValidWallPlacement(cand.r, cand.c, cand.type)) {
                    minDist = dist;
                    best = cand;
                }
            }
        }
    }

    if (best) {
        if (!hoverWall || hoverWall.r !== best.r || hoverWall.c !== best.c || hoverWall.type !== best.type) {
            hoverWall = { r: best.r, c: best.c, type: best.type };
            renderBoard();
        }
    } else {
        if (hoverWall) {
            clearHoverPreview();
        }
    }
}

function clearHoverPreview() {
    if (hoverWall) {
        hoverWall = null;
        renderBoard();
    }
}

function placeWall(r, c, type) {
    if (!['PLACE_RED_WALL', 'PLACE_BLUE_WALL', 'WALL_PLACE'].includes(gameState)) return;

    if (isValidWallPlacement(r, c, type)) {
        walls.push({ r, c, type });
        
        // 联机发送
        if (isMultiplayer) {
            sendMove({ type: 'PLACE_WALL', r, c, type });
        }

        if (gameState === 'PLACE_RED_WALL') {
            gameState = 'PLACE_BLUE';
            selectedPiecePos = null;
            if (isMultiplayer) {
                sendMove({ type: 'TURN_CHANGE', nextState: 'PLACE_BLUE' });
            }
        } else if (gameState === 'PLACE_BLUE_WALL') {
            gameState = 'MOVE_SELECT';
            currentPlayer = 'red';
            selectedPiecePos = null;
            if (isMultiplayer) {
                sendMove({ type: 'TURN_CHANGE', nextState: 'MOVE_SELECT' });
            }
        } else if (gameState === 'WALL_PLACE') {
            if (checkWin()) {
                if (isMultiplayer) sendMove({ type: 'GAME_OVER', msg: "游戏结束" });
                return;
            }
            currentPlayer = currentPlayer === 'red' ? 'blue' : 'red';
            gameState = 'MOVE_SELECT';
            selectedPiecePos = null;
        }

        hoverWall = null;
        renderBoard();
        updateStatus();
    }
}

function isValidWallPlacement(r, c, type) {
    if (type === 'h') {
        if (r < 0 || r >= BOARD_SIZE - 1) return false;
        if (c < 0 || c >= BOARD_SIZE) return false;
    } else {
        if (r < 0 || r >= BOARD_SIZE) return false;
        if (c < 0 || c >= BOARD_SIZE - 1) return false;
    }

    if (walls.some(w => w.r === r && w.c === c && w.type === type)) return false;

    if (selectedPiecePos) {
        const pr = selectedPiecePos.r;
        const pc = selectedPiecePos.c;
        if (type === 'h') {
            if (!((r === pr - 1 && c === pc) || (r === pr && c === pc))) return false;
        } else {
            if (!((c === pc - 1 && r === pr) || (c === pc && r === pr))) return false;
        }
    }

    return true;
}

function isValidTarget(from, to) {
    if (from.r === to.r && from.c === to.c) return false;
    if (boardState[to.r][to.c].hasPiece) return false;
    
    const reachable = getReachableCells(from.r, from.c);
    return reachable.some(p => p.r === to.r && p.c === to.c);
}

function getReachableCells(startR, startC, ignoreOpponent = true) {
    const visited = new Set();
    const queue = [{ r: startR, c: startC }];
    const result = [];
    visited.add(`${startR},${startC}`);

    while (queue.length > 0) {
        const { r, c } = queue.shift();
        result.push({ r, c });

        const dirs = [
            { dr: -1, dc: 0, wType: 'h', wr: r - 1, wc: c },
            { dr: 1, dc: 0, wType: 'h', wr: r, wc: c },
            { dr: 0, dc: -1, wType: 'v', wr: r, wc: c - 1 },
            { dr: 0, dc: 1, wType: 'v', wr: r, wc: c }
        ];

        for (let d of dirs) {
            const nr = r + d.dr, nc = c + d.dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;

            if (walls.some(w => w.type === d.wType && w.r === d.wr && w.c === d.wc)) continue;

            if (ignoreOpponent) {
                if (boardState[nr][nc].hasPiece && boardState[nr][nc].hasPiece !== currentPlayer) continue;
            }

            const key = `${nr},${nc}`;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push({ r: nr, c: nc });
            }
        }
    }
    return result;
}

function updateStatus() {
    if (!statusText) return;
    let msg = "", color = "#333";
    const playerCN = currentPlayer === 'red' ? '红方' : '蓝方';
    
    switch (gameState) {
        case 'PLACE_RED': msg = "红方：请点击棋盘任意空格放置棋子"; color = "#ff4d4f"; break;
        case 'PLACE_RED_WALL': msg = "红方：棋子已放！请将鼠标移至棋子四周缝隙，点击黄色条放置隔板"; color = "#faad14"; break;
        case 'PLACE_BLUE': msg = "蓝方：请点击棋盘任意空格放置棋子"; color = "#1890ff"; break;
        case 'PLACE_BLUE_WALL': msg = "蓝方：棋子已放！请将鼠标移至棋子四周缝隙，点击黄色条放置隔板"; color = "#faad14"; break;
        case 'MOVE_SELECT': msg = `${playerCN}：点击己方棋子准备移动`; color = currentPlayer === 'red' ? "#ff4d4f" : "#1890ff"; break;
        case 'MOVE_TARGET': msg = `${playerCN}：点击高亮格子进行瞬移`; color = currentPlayer === 'red' ? "#ff4d4f" : "#1890ff"; break;
        case 'WALL_PLACE': msg = `${playerCN}：移动完成！请将鼠标移至棋子四周缝隙，点击黄色条放置隔板`; color = "#faad14"; break;
        case 'WAITING_OPPONENT': msg = "等待对手操作..."; color = "#999"; break;
    }
    statusText.innerText = msg;
    statusText.style.color = color;
    if (modeDisplay) modeDisplay.innerText = gameState;
}

function checkWin() {
    const redPos = findPiece('red');
    const bluePos = findPiece('blue');
    
    if (!redPos || !bluePos) return true; 

    const nextPlayer = currentPlayer === 'red' ? 'blue' : 'red';
    const nextPos = nextPlayer === 'red' ? redPos : bluePos;
    
    const originalPlayer = currentPlayer;
    currentPlayer = nextPlayer;
    const nextMoves = getReachableCells(nextPos.r, nextPos.c, true).filter(p => !(p.r === nextPos.r && p.c === nextPos.c));
    currentPlayer = originalPlayer;

    if (nextMoves.length === 0) {
        showWinMessage(`${currentPlayer === 'red' ? '红方' : '蓝方'} 获胜`, "对方已无路可走！");
        return true;
    }

    const isConnect = checkConnectivity(redPos, bluePos);

    if (!isConnect) {
        const redWallCount = countValidWallPlacements(redPos);
        const blueWallCount = countValidWallPlacements(bluePos);
        
        let winnerText = "";
        let reasonText = `双方已被完全隔断！统计双方领地内剩余可放置的隔板数量：\n\n`;
        reasonText += `🔴 红方可放置隔板数：${redWallCount}\n`;
        reasonText += `🔵 蓝方可放置隔板数：${blueWallCount}\n\n`;

        if (redWallCount > blueWallCount) {
            winnerText = "红方 获胜";
            reasonText += "结论：红方领地内可放置的隔板更多，获胜！";
        } else if (blueWallCount > redWallCount) {
            winnerText = "蓝方 获胜";
            reasonText += "结论：蓝方领地内可放置的隔板更多，获胜！";
        } else {
            winnerText = "平局";
            reasonText += "结论：双方可放置隔板数量相同，平局！";
        }
        
        showWinMessage(winnerText, reasonText);
        return true;
    }

    return false;
}

function checkConnectivity(startPos, endPos) {
    const visited = new Set();
    const queue = [{ r: startPos.r, c: startPos.c }];
    visited.add(`${startPos.r},${startPos.c}`);

    while (queue.length > 0) {
        const { r, c } = queue.shift();

        if (r === endPos.r && c === endPos.c) {
            return true;
        }

        const dirs = [
            { dr: -1, dc: 0, wType: 'h', wr: r - 1, wc: c },
            { dr: 1, dc: 0, wType: 'h', wr: r, wc: c },
            { dr: 0, dc: -1, wType: 'v', wr: r, wc: c - 1 },
            { dr: 0, dc: 1, wType: 'v', wr: r, wc: c }
        ];

        for (let d of dirs) {
            const nr = r + d.dr, nc = c + d.dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;

            if (walls.some(w => w.type === d.wType && w.r === d.wr && w.c === d.wc)) continue;

            const key = `${nr},${nc}`;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push({ r: nr, c: nc });
            }
        }
    }
    return false;
}

function countValidWallPlacements(piecePos) {
    const reachableSet = new Set();
    const reachableList = getReachableCells(piecePos.r, piecePos.c, true);
    reachableList.forEach(p => reachableSet.add(`${p.r},${p.c}`));

    let count = 0;

    for (let r = 0; r < BOARD_SIZE - 1; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const topCell = `${r},${c}`;
            const bottomCell = `${r+1},${c}`;
            
            if (reachableSet.has(topCell) && reachableSet.has(bottomCell)) {
                if (!walls.some(w => w.type === 'h' && w.r === r && w.c === c)) {
                    count++;
                }
            }
        }
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE - 1; c++) {
            const leftCell = `${r},${c}`;
            const rightCell = `${r},${c+1}`;
            
            if (reachableSet.has(leftCell) && reachableSet.has(rightCell)) {
                if (!walls.some(w => w.type === 'v' && w.r === r && w.c === c)) {
                    count++;
                }
            }
        }
    }

    return count;
}

function showWinMessage(title, detail) {
    setTimeout(() => {
        alert(`🏆 ${title}\n\n${detail}`);
        initGame();
        if (isMultiplayer) leaveRoom();
    }, 100);
}

function findPiece(player) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (boardState[r][c].hasPiece === player) return { r, c };
        }
    }
    return null;
}

// ================= 联机模块 (修复版) =================

function initNetwork() {
    console.log("🌐 正在尝试连接联机服务器...");
    updateNetworkStatus("正在连接服务器 (最多等待 8 秒)...");

    const peerConfig = {
        debug: 2,
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' }
            ]
        }
    };

    try {
        peer = new Peer(null, peerConfig);
    } catch (e) {
        console.error("❌ PeerJS 初始化失败:", e);
        handleConnectionFailure("浏览器不支持或初始化失败");
        return;
    }

    connectionTimeout = setTimeout(() => {
        if (peer && !peer.id) {
            console.warn("⏳ 连接超时");
            handleConnectionFailure("连接超时：服务器响应太慢");
            if (peer) peer.destroy();
        }
    }, 8000);

    peer.on('open', (id) => {
        console.log('✅ 连接成功！我的 ID:', id);
        clearTimeout(connectionTimeout);
        updateNetworkStatus("✅ 网络已就绪 | 我的 ID: " + id);
        enableLobbyControls(true);
    });

    peer.on('error', (err) => {
        console.error('❌ 网络错误:', err.type, err.message);
        clearTimeout(connectionTimeout);
        
        let msg = "网络连接失败";
        if (err.type === 'network') msg = "网络不通 (防火墙/代理)";
        if (err.type === 'ssl-unavailable') msg = "SSL 连接失败";
        if (err.type === 'server-error') msg = "服务器错误";
        
        handleConnectionFailure(msg);
    });

    peer.on('connection', (c) => {
        if (conn && conn.open) {
            c.close();
            return;
        }
        console.log("🤝 收到玩家连接请求");
        conn = c;
        setupConnectionHandlers();
        myRole = 'red';
        startMultiplayerGame('red');
    });
}

function handleConnectionFailure(reason) {
    updateNetworkStatus("❌ 联机失败: " + reason);
    enableLobbyControls(false);

    alert("联机服务暂时不可用 (" + reason + ")。\n建议:\n1. 刷新页面重试\n2. 切换 WiFi/4G\n3. 先体验单机模式");
    
    if (boardElement) {
        renderBoard();
        updateStatus();
    }
}

function setupConnectionHandlers() {
    if (!conn) return;

    conn.on('open', () => {
        console.log("🔗 P2P 通道已建立");
        isMultiplayer = true;
        updateStatus("联机对战中 | 你是: " + (myRole === 'red' ? "红方 (先手)" : "蓝方 (后手)"));
    });

    conn.on('data', (data) => {
        console.log("📩 收到数据:", data);
        handleNetworkData(data);
    });

    conn.on('close', () => {
        console.log("🔌 对方断开连接");
        alert("对手已断开连接");
        leaveRoom();
    });
    
    conn.on('error', (err) => {
        console.error("连接错误:", err);
        alert("连接出错：" + err);
    });
}

function handleNetworkData(data) {
    switch (data.type) {
        case 'PIECE_PLACED':
            boardState[data.r][data.c].hasPiece = data.color;
            if (data.color === 'red') {
                gameState = 'PLACE_RED_WALL';
                selectedPiecePos = { r: data.r, c: data.c };
            } else {
                gameState = 'PLACE_BLUE_WALL';
                selectedPiecePos = { r: data.r, c: data.c };
            }
            renderBoard();
            updateStatus();
            break;
            
        case 'MOVE_PIECE':
            boardState[data.from.r][data.from.c].hasPiece = null;
            boardState[data.to.r][data.to.c].hasPiece = (myRole === 'red' ? 'blue' : 'red');
            gameState = 'WAITING_OPPONENT';
            updateStatus();
            renderBoard();
            break;
            
        case 'PLACE_WALL':
            walls.push({ r: data.r, c: data.c, type: data.type });
            // 根据当前状态判断下一步
            const blueExists = findPiece('blue');
            if (!blueExists && myRole === 'blue') {
                gameState = 'PLACE_BLUE';
                currentPlayer = 'blue';
            } else {
                gameState = 'MOVE_SELECT';
                currentPlayer = myRole;
            }
            boardElement.style.pointerEvents = 'auto';
            hoverWall = null;
            renderBoard();
            updateStatus();
            break;
            
        case 'TURN_CHANGE':
            gameState = data.nextState;
            currentPlayer = myRole;
            updateStatus();
            break;
            
        case 'GAME_OVER':
            alert("游戏结束：" + data.msg);
            initGame();
            leaveRoom();
            break;
    }
}

function createRoom() {
    if (!peer || !peer.id) {
        alert("尚未连接到服务器，请稍后...");
        return;
    }
    
    alert("房间创建成功！\n你的房间号是:\n【 " + peer.id + " 】\n\n请把这个号码发给朋友，让他点击'加入房间'并输入此号码。");
    
    const displayEl = document.getElementById('room-display');
    if (displayEl) displayEl.innerText = "当前房间: " + peer.id;
    
    myRole = 'red';
    updateStatus("等待对手加入... (房间号: " + peer.id + ")");
}

function joinRoom() {
    if (!peer || !peer.id) {
        alert("尚未连接到服务器，请稍后...");
        return;
    }
    
    const roomId = prompt("请输入朋友的房间号:");
    if (!roomId) return;

    if (roomId === peer.id) {
        alert("不能加入自己的房间！");
        return;
    }

    updateNetworkStatus("正在连接房间: " + roomId + "...");
    
    const c = peer.connect(roomId);
    conn = c;
    myRole = 'blue';
    setupConnectionHandlers();
}

function enableLobbyControls(enable) {
    const input = document.getElementById('room-id-input');
    const createBtn = document.getElementById('create-room-btn');
    const joinBtn = document.getElementById('join-room-btn');
    
    if (input) input.disabled = !enable;
    if (createBtn) createBtn.disabled = !enable;
    if (joinBtn) joinBtn.disabled = !enable;
}

function updateNetworkStatus(msg) {
    if (networkStatusEl) {
        networkStatusEl.innerText = msg;
        if (msg.includes("✅")) networkStatusEl.style.color = "green";
        else if (msg.includes("❌")) networkStatusEl.style.color = "red";
        else networkStatusEl.style.color = "#333";
    }
}

function leaveRoom() {
    if (conn) conn.close();
    if (peer) peer.destroy();
    conn = null;
    peer = null;
    isMultiplayer = false;
    myRole = null;
    
    const lobbyControls = document.getElementById('lobby-controls');
    const gameControls = document.getElementById('game-controls');
    if (lobbyControls) lobbyControls.style.display = 'block';
    if (gameControls) gameControls.style.display = 'none';
    
    updateNetworkStatus("已退出房间 (单机模式)");
    initGame();
}

function startMultiplayerGame(role) {
    initGame();
    
    if (role === 'blue') {
        gameState = 'WAITING_OPPONENT';
        updateStatus();
        if (statusText) {
            statusText.innerText = "等待红方放置棋子...";
            statusText.style.color = "#999";
        }
        if (boardElement) boardElement.style.pointerEvents = 'none';
    } else {
        gameState = 'PLACE_RED';
        updateStatus();
        if (boardElement) boardElement.style.pointerEvents = 'auto';
    }
    
    const lobbyControls = document.getElementById('lobby-controls');
    const gameControls = document.getElementById('game-controls');
    if (lobbyControls) lobbyControls.style.display = 'none';
    if (gameControls) gameControls.style.display = 'block';
    
    const roleEl = document.getElementById('my-role');
    if (roleEl) {
        roleEl.innerText = role === 'red' ? "我是红方 (先手)" : "我是蓝方 (后手)";
        roleEl.style.color = role === 'red' ? "#ff4d4f" : "#1890ff";
    }
}

function sendMove(data) {
    if (conn && conn.open) {
        conn.send(data);
    }
}

// ================= 启动 =================
// window.onload 已处理，这里不需要再调用
