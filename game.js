// ================= 配置常量 =================
const BOARD_SIZE = 8;
const CELL_SIZE = 50;
const GAP_SIZE = 2;
const TOTAL_STEP = CELL_SIZE + GAP_SIZE;
const WALL_THICKNESS = GAP_SIZE + 4;
const HIT_TOLERANCE = 15;

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
let connectionRetryCount = 0;
const MAX_RETRY = 2;

// ================= DOM 元素 =================
let boardElement = null;
let statusText = null;
let modeDisplay = null;
let networkStatusEl = null;
let roomInput = null;
let createBtn = null;
let joinBtn = null;
let roomDisplayEl = null;
let myRoleEl = null;
let gameControls = null;
let lobbyControls = null;

// ================= 页面加载入口 =================
window.onload = function() {
    console.log("🚀 游戏正在启动...");
    
    // 获取 DOM 元素
    boardElement = document.getElementById('board');
    statusText = document.getElementById('status-text');
    modeDisplay = document.getElementById('mode-display');
    networkStatusEl = document.getElementById('network-status');
    roomInput = document.getElementById('room-id-input');
    createBtn = document.getElementById('create-room-btn');
    joinBtn = document.getElementById('join-room-btn');
    roomDisplayEl = document.getElementById('room-display');
    myRoleEl = document.getElementById('my-role');
    gameControls = document.getElementById('game-controls');
    lobbyControls = document.getElementById('lobby-controls');
    
    if (!boardElement) {
        console.error("❌ 找不到 #board 元素");
        document.body.innerHTML += "<div style='color:red;padding:20px;'>错误：页面缺少棋盘元素</div>";
        return;
    }
    
    // 【修复】先绑定棋盘事件，再初始化游戏
    bindBoardEvents();
    initGame();
    setTimeout(initNetwork, 500);
};

// ================= 事件绑定（独立函数）=================
function bindBoardEvents() {
    if (!boardElement) return;
    
    // 移除旧事件（避免重复）
    const newBoard = boardElement.cloneNode(false);
    boardElement.parentNode.replaceChild(newBoard, boardElement);
    boardElement = document.getElementById('board');
    
    // 绑定鼠标移动事件
    boardElement.addEventListener('mousemove', handleGlobalMouseMove);
    boardElement.addEventListener('mouseleave', function() {
        if (hoverWall) clearHoverPreview();
    });
    
    console.log("✅ 棋盘事件已绑定");
}

// ================= 游戏核心逻辑 =================

function initGame() {
    console.log("🔄 初始化游戏...");
    
    boardState = [];
    walls = [];
    currentPlayer = 'red';
    gameState = 'PLACE_RED';
    selectedPiecePos = null;
    hoverWall = null;
    lastMousePos = { x: -9999, y: -9999 };

    // 初始化棋盘状态
    for (let r = 0; r < BOARD_SIZE; r++) {
        let row = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            row.push({ hasPiece: null });
        }
        boardState.push(row);
    }

    // 【修复】不清空 boardElement，直接渲染
    renderBoard();
    updateStatus();
    
    // 【修复】确保棋盘可点击
    if (boardElement) {
        boardElement.style.pointerEvents = 'auto';
    }
}

function renderBoard() {
    if (!boardElement) {
        console.error("❌ boardElement 为空");
        return;
    }
    
    boardElement.innerHTML = '';

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.r = r;
            cell.dataset.c = c;
            
            // 【修复】确保 cell 可点击
            cell.style.pointerEvents = 'auto';
            cell.style.cursor = 'pointer';

            if (boardState[r][c].hasPiece) {
                const piece = document.createElement('div');
                piece.className = 'piece ' + boardState[r][c].hasPiece;
                cell.appendChild(piece);
            }

            if (gameState === 'MOVE_TARGET' && selectedPiecePos) {
                if (isValidTarget(selectedPiecePos, {r: r, c: c})) {
                    cell.classList.add('highlight');
                }
            }

            // 【修复】使用闭包保存 r, c 值
            (function(row, col) {
                cell.addEventListener('click', function(e) {
                    e.stopPropagation();
                    console.log("🖱️ 点击棋盘:", row, col, "当前状态:", gameState);
                    handleCellClick(row, col);
                });
            })(r, c);
            
            boardElement.appendChild(cell);
        }
    }

    // 渲染隔板
    for (let i = 0; i < walls.length; i++) {
        let w = walls[i];
        createWallDOM(w.r, w.c, w.type, false);
    }

    if (hoverWall) {
        createWallDOM(hoverWall.r, hoverWall.c, hoverWall.type, true);
    }
    
    console.log("✅ 棋盘渲染完成，格子数:", BOARD_SIZE * BOARD_SIZE);
}

function createWallDOM(r, c, type, isPreview) {
    const el = document.createElement('div');
    el.className = 'wall ' + (type === 'h' ? 'horizontal' : 'vertical');
    
    if (isPreview) {
        el.classList.add('wall-preview');
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.title = "点击放置隔板";
        el.addEventListener('click', function(e) {
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
        el.style.width = CELL_SIZE + 'px';
        el.style.height = WALL_THICKNESS + 'px';
    } else {
        top = r * TOTAL_STEP + (GAP_SIZE / 2);
        left = (c + 1) * TOTAL_STEP - (WALL_THICKNESS / 2);
        el.style.height = CELL_SIZE + 'px';
        el.style.width = WALL_THICKNESS + 'px';
    }

    el.style.top = top + 'px';
    el.style.left = left + 'px';
    if (boardElement) boardElement.appendChild(el);
}

function handleGlobalMouseMove(e) {
    if (!boardElement) return;
    const rect = boardElement.getBoundingClientRect();
    lastMousePos.x = e.clientX - rect.left;
    lastMousePos.y = e.clientY - rect.top;

    if (gameState === 'PLACE_RED_WALL' || gameState === 'PLACE_BLUE_WALL' || gameState === 'WALL_PLACE') {
        detectHoverWall(lastMousePos.x, lastMousePos.y);
    }
}

function handleCellClick(r, c) {
    console.log("📍 handleCellClick 被调用:", r, c, "gameState:", gameState);
    
    const cell = boardState[r][c];

    // 联机等待对手时禁用点击
    if (isMultiplayer && gameState === 'WAITING_OPPONENT') {
        console.log("⏸️ 等待对手，忽略点击");
        return;
    }

    // 放置红棋
    if (gameState === 'PLACE_RED') {
        if (!cell.hasPiece) {
            boardState[r][c].hasPiece = 'red';
            selectedPiecePos = { r: r, c: c };
            gameState = 'PLACE_RED_WALL';
            finishSetupPhase();
            if (isMultiplayer && myRole === 'red') {
                sendMove({ type: 'PIECE_PLACED', r: r, c: c, color: 'red' });
            }
        } else {
            if (!isMultiplayer) alert("此处已有棋子");
        }
        return;
    }

    // 放置蓝棋
    if (gameState === 'PLACE_BLUE') {
        if (!cell.hasPiece) {
            boardState[r][c].hasPiece = 'blue';
            selectedPiecePos = { r: r, c: c };
            gameState = 'PLACE_BLUE_WALL';
            finishSetupPhase();
            if (isMultiplayer && myRole === 'blue') {
                sendMove({ type: 'PIECE_PLACED', r: r, c: c, color: 'blue' });
            }
        } else {
            if (!isMultiplayer) alert("此处已有棋子");
        }
        return;
    }

    // 选择棋子
    if (gameState === 'MOVE_SELECT') {
        if (cell.hasPiece === currentPlayer) {
            selectedPiecePos = { r: r, c: c };
            gameState = 'MOVE_TARGET';
            renderBoard();
            updateStatus();
        } else if (cell.hasPiece) {
            console.log("⚠️ 点击了对方棋子");
        }
        return;
    }

    // 移动棋子
    if (gameState === 'MOVE_TARGET') {
        if (!selectedPiecePos) {
            console.log("⚠️ 没有选中的棋子");
            return;
        }
        if (isValidTarget(selectedPiecePos, { r: r, c: c })) {
            const moveData = { 
                type: 'MOVE_PIECE', 
                from: selectedPiecePos, 
                to: { r: r, c: c } 
            };
            boardState[selectedPiecePos.r][selectedPiecePos.c].hasPiece = null;
            boardState[r][c].hasPiece = currentPlayer;
            selectedPiecePos = { r: r, c: c };
            gameState = 'WALL_PLACE';
            renderBoard();
            updateStatus();
            forceDetectAfterMove();
            if (isMultiplayer) sendMove(moveData);
        } else {
            console.log("⚠️ 无效的移动目标");
        }
        return;
    }
    
    console.log("⚠️ 未处理的 gameState:", gameState);
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
        candidates.push({
            r: pr - 1, c: pc, type: 'h',
            xMin: pc * TOTAL_STEP - HIT_TOLERANCE,
            xMax: pc * TOTAL_STEP + CELL_SIZE + HIT_TOLERANCE,
            yMin: pr * TOTAL_STEP - WALL_THICKNESS/2 - HIT_TOLERANCE,
            yMax: pr * TOTAL_STEP - WALL_THICKNESS/2 + HIT_TOLERANCE
        });
    }
    if (pr < BOARD_SIZE - 1) {
        candidates.push({
            r: pr, c: pc, type: 'h',
            xMin: pc * TOTAL_STEP - HIT_TOLERANCE,
            xMax: pc * TOTAL_STEP + CELL_SIZE + HIT_TOLERANCE,
            yMin: (pr + 1) * TOTAL_STEP - WALL_THICKNESS/2 - HIT_TOLERANCE,
            yMax: (pr + 1) * TOTAL_STEP - WALL_THICKNESS/2 + HIT_TOLERANCE
        });
    }
    if (pc > 0) {
        candidates.push({
            r: pr, c: pc - 1, type: 'v',
            xMin: pc * TOTAL_STEP - WALL_THICKNESS/2 - HIT_TOLERANCE,
            xMax: pc * TOTAL_STEP - WALL_THICKNESS/2 + HIT_TOLERANCE,
            yMin: pr * TOTAL_STEP - HIT_TOLERANCE,
            yMax: pr * TOTAL_STEP + CELL_SIZE + HIT_TOLERANCE
        });
    }
    if (pc < BOARD_SIZE - 1) {
        candidates.push({
            r: pr, c: pc, type: 'v',
            xMin: (pc + 1) * TOTAL_STEP - WALL_THICKNESS/2 - HIT_TOLERANCE,
            xMax: (pc + 1) * TOTAL_STEP - WALL_THICKNESS/2 + HIT_TOLERANCE,
            yMin: pr * TOTAL_STEP - HIT_TOLERANCE,
            yMax: pr * TOTAL_STEP + CELL_SIZE + HIT_TOLERANCE
        });
    }

    let best = null;
    let minDist = Infinity;

    for (let i = 0; i < candidates.length; i++) {
        let cand = candidates[i];
        if (mx >= cand.xMin && mx <= cand.xMax && my >= cand.yMin && my <= cand.yMax) {
            const cx = (cand.xMin + cand.xMax) / 2;
            const cy = (cand.yMin + cand.yMax) / 2;
            const dist = Math.sqrt((mx - cx) * (mx - cx) + (my - cy) * (my - cy));
            if (dist < minDist && isValidWallPlacement(cand.r, cand.c, cand.type)) {
                minDist = dist;
                best = cand;
            }
        }
    }

    if (best) {
        if (!hoverWall || hoverWall.r !== best.r || hoverWall.c !== best.c || hoverWall.type !== best.type) {
            hoverWall = { r: best.r, c: best.c, type: best.type };
            renderBoard();
        }
    } else if (hoverWall) {
        clearHoverPreview();
    }
}

function clearHoverPreview() {
    if (hoverWall) {
        hoverWall = null;
        renderBoard();
    }
}

function placeWall(r, c, type) {
    console.log("🧱 放置隔板:", r, c, type, "gameState:", gameState);
    
    if (gameState !== 'PLACE_RED_WALL' && gameState !== 'PLACE_BLUE_WALL' && gameState !== 'WALL_PLACE') {
        console.log("⚠️ 当前状态不允许放置隔板");
        return;
    }

    if (isValidWallPlacement(r, c, type)) {
        walls.push({ r: r, c: c, type: type });
        
        if (isMultiplayer) {
            sendMove({ type: 'PLACE_WALL', r: r, c: c, type: type });
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
            currentPlayer = (currentPlayer === 'red') ? 'blue' : 'red';
            gameState = 'MOVE_SELECT';
            selectedPiecePos = null;
        }

        hoverWall = null;
        renderBoard();
        updateStatus();
    } else {
        console.log("⚠️ 隔板位置无效");
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

    for (let i = 0; i < walls.length; i++) {
        if (walls[i].r === r && walls[i].c === c && walls[i].type === type) {
            return false;
        }
    }

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
    for (let i = 0; i < reachable.length; i++) {
        if (reachable[i].r === to.r && reachable[i].c === to.c) {
            return true;
        }
    }
    return false;
}

function getReachableCells(startR, startC, ignoreOpponent) {
    if (ignoreOpponent === undefined) ignoreOpponent = true;
    
    const visited = {};
    const queue = [{ r: startR, c: startC }];
    const result = [];
    visited[startR + ',' + startC] = true;

    while (queue.length > 0) {
        const pos = queue.shift();
        const r = pos.r;
        const c = pos.c;
        result.push({ r: r, c: c });

        const dirs = [
            { dr: -1, dc: 0, wType: 'h', wr: r - 1, wc: c },
            { dr: 1, dc: 0, wType: 'h', wr: r, wc: c },
            { dr: 0, dc: -1, wType: 'v', wr: r, wc: c - 1 },
            { dr: 0, dc: 1, wType: 'v', wr: r, wc: c }
        ];

        for (let i = 0; i < dirs.length; i++) {
            const d = dirs[i];
            const nr = r + d.dr;
            const nc = c + d.dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;

            let wallBlocked = false;
            for (let j = 0; j < walls.length; j++) {
                if (walls[j].type === d.wType && walls[j].r === d.wr && walls[j].c === d.wc) {
                    wallBlocked = true;
                    break;
                }
            }
            if (wallBlocked) continue;

            if (ignoreOpponent) {
                if (boardState[nr][nc].hasPiece && boardState[nr][nc].hasPiece !== currentPlayer) continue;
            }

            const key = nr + ',' + nc;
            if (!visited[key]) {
                visited[key] = true;
                queue.push({ r: nr, c: nc });
            }
        }
    }
    return result;
}

function updateStatus() {
    if (!statusText) return;
    let msg = "";
    let color = "#333";
    const playerCN = (currentPlayer === 'red') ? '红方' : '蓝方';
    
    switch (gameState) {
        case 'PLACE_RED':
            msg = "红方：请点击棋盘任意空格放置棋子";
            color = "#ff4d4f";
            break;
        case 'PLACE_RED_WALL':
            msg = "红方：棋子已放！请将鼠标移至棋子四周缝隙，点击黄色条放置隔板";
            color = "#faad14";
            break;
        case 'PLACE_BLUE':
            msg = "蓝方：请点击棋盘任意空格放置棋子";
            color = "#1890ff";
            break;
        case 'PLACE_BLUE_WALL':
            msg = "蓝方：棋子已放！请将鼠标移至棋子四周缝隙，点击黄色条放置隔板";
            color = "#faad14";
            break;
        case 'MOVE_SELECT':
            msg = playerCN + "：点击己方棋子准备移动";
            color = (currentPlayer === 'red') ? "#ff4d4f" : "#1890ff";
            break;
        case 'MOVE_TARGET':
            msg = playerCN + "：点击高亮格子进行瞬移";
            color = (currentPlayer === 'red') ? "#ff4d4f" : "#1890ff";
            break;
        case 'WALL_PLACE':
            msg = playerCN + "：移动完成！请将鼠标移至棋子四周缝隙，点击黄色条放置隔板";
            color = "#faad14";
            break;
        case 'WAITING_OPPONENT':
            msg = "等待对手操作...";
            color = "#999";
            break;
        default:
            msg = "游戏进行中";
            color = "#333";
    }
    
    statusText.innerText = msg;
    statusText.style.color = color;
    if (modeDisplay) modeDisplay.innerText = gameState;
}

function checkWin() {
    const redPos = findPiece('red');
    const bluePos = findPiece('blue');
    
    if (!redPos || !bluePos) return true;

    const nextPlayer = (currentPlayer === 'red') ? 'blue' : 'red';
    const nextPos = (nextPlayer === 'red') ? redPos : bluePos;
    
    const originalPlayer = currentPlayer;
    currentPlayer = nextPlayer;
    const nextMoves = getReachableCells(nextPos.r, nextPos.c, true);
    const validMoves = [];
    for (let i = 0; i < nextMoves.length; i++) {
        if (!(nextMoves[i].r === nextPos.r && nextMoves[i].c === nextPos.c)) {
            validMoves.push(nextMoves[i]);
        }
    }
    currentPlayer = originalPlayer;

    if (validMoves.length === 0) {
        const winnerText = (currentPlayer === 'red') ? '红方' : '蓝方';
        showWinMessage(winnerText + " 获胜", "对方已无路可走！");
        return true;
    }

    const isConnect = checkConnectivity(redPos, bluePos);

    if (!isConnect) {
        const redWallCount = countValidWallPlacements(redPos);
        const blueWallCount = countValidWallPlacements(bluePos);
        
        let winnerText = "";
        let reasonText = "双方已被完全隔断！\n\n";
        reasonText += "🔴 红方可放置隔板数：" + redWallCount + "\n";
        reasonText += "🔵 蓝方可放置隔板数：" + blueWallCount + "\n\n";

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
    const visited = {};
    const queue = [{ r: startPos.r, c: startPos.c }];
    visited[startPos.r + ',' + startPos.c] = true;

    while (queue.length > 0) {
        const pos = queue.shift();
        const r = pos.r;
        const c = pos.c;

        if (r === endPos.r && c === endPos.c) {
            return true;
        }

        const dirs = [
            { dr: -1, dc: 0, wType: 'h', wr: r - 1, wc: c },
            { dr: 1, dc: 0, wType: 'h', wr: r, wc: c },
            { dr: 0, dc: -1, wType: 'v', wr: r, wc: c - 1 },
            { dr: 0, dc: 1, wType: 'v', wr: r, wc: c }
        ];

        for (let i = 0; i < dirs.length; i++) {
            const d = dirs[i];
            const nr = r + d.dr;
            const nc = c + d.dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;

            let wallBlocked = false;
            for (let j = 0; j < walls.length; j++) {
                if (walls[j].type === d.wType && walls[j].r === d.wr && walls[j].c === d.wc) {
                    wallBlocked = true;
                    break;
                }
            }
            if (wallBlocked) continue;

            const key = nr + ',' + nc;
            if (!visited[key]) {
                visited[key] = true;
                queue.push({ r: nr, c: nc });
            }
        }
    }
    return false;
}

function countValidWallPlacements(piecePos) {
    const reachableSet = {};
    const reachableList = getReachableCells(piecePos.r, piecePos.c, true);
    for (let i = 0; i < reachableList.length; i++) {
        const p = reachableList[i];
        reachableSet[p.r + ',' + p.c] = true;
    }

    let count = 0;

    for (let r = 0; r < BOARD_SIZE - 1; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const topCell = r + ',' + c;
            const bottomCell = (r+1) + ',' + c;
            
            if (reachableSet[topCell] && reachableSet[bottomCell]) {
                let hasWall = false;
                for (let i = 0; i < walls.length; i++) {
                    if (walls[i].type === 'h' && walls[i].r === r && walls[i].c === c) {
                        hasWall = true;
                        break;
                    }
                }
                if (!hasWall) count++;
            }
        }
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE - 1; c++) {
            const leftCell = r + ',' + c;
            const rightCell = r + ',' + (c+1);
            
            if (reachableSet[leftCell] && reachableSet[rightCell]) {
                let hasWall = false;
                for (let i = 0; i < walls.length; i++) {
                    if (walls[i].type === 'v' && walls[i].r === r && walls[i].c === c) {
                        hasWall = true;
                        break;
                    }
                }
                if (!hasWall) count++;
            }
        }
    }

    return count;
}

function showWinMessage(title, detail) {
    setTimeout(function() {
        alert("🏆 " + title + "\n\n" + detail);
        initGame();
        if (isMultiplayer) leaveRoom();
    }, 100);
}

function findPiece(player) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (boardState[r][c].hasPiece === player) {
                return { r: r, c: c };
            }
        }
    }
    return null;
}

// ================= 联机模块 =================

function initNetwork() {
    console.log("🌐 正在尝试连接联机服务器...");
    updateNetworkStatus("正在连接服务器...");

    if (!roomInput || !createBtn) {
        console.error("❌ 找不到输入框或按钮");
        enableLobbyControls(true);
        return;
    }

    // 【关键修复】使用多个备用服务器，优先尝试国内可访问的
    const serverConfigs = [
        {
            host: 'peerjs-server.onrender.com',
            port: 443,
            secure: true
        },
        {
            host: 'peerjs.minimalist.com',
            port: 443,
            secure: true
        },
        {
            host: '0.peerjs.com',
            port: 443,
            secure: true
        }
    ];

    let currentServerIndex = 0;

    function tryConnect() {
        if (currentServerIndex >= serverConfigs.length) {
            handleConnectionFailure("所有服务器均不可用");
            return;
        }

        const config = serverConfigs[currentServerIndex];
        console.log(`🔄 尝试服务器 ${currentServerIndex + 1}/${serverConfigs.length}: ${config.host}`);
        updateNetworkStatus(`尝试连接服务器 ${currentServerIndex + 1}/${serverConfigs.length}...`);

        const peerConfig = {
            debug: 0,
            host: config.host,
            port: config.port,
            secure: config.secure,
            config: {
                'iceServers': [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun.services.mozilla.com' },
                    { urls: 'stun:stun.stunprotocol.org' }
                ]
            }
        };

        try {
            peer = new Peer(null, peerConfig);
        } catch (e) {
            console.error("❌ PeerJS 初始化失败:", e);
            currentServerIndex++;
            tryConnect();
            return;
        }

        // 延长超时时间到 15 秒
        connectionTimeout = setTimeout(function() {
            if (peer && !peer.id) {
                console.warn("⏳ 连接超时，尝试下一个服务器");
                if (peer) peer.destroy();
                peer = null;
                currentServerIndex++;
                tryConnect();
            }
        }, 15000);

        peer.on('open', function(id) {
            console.log('✅ 连接成功！ID:', id, '服务器:', config.host);
            clearTimeout(connectionTimeout);
            connectionRetryCount = 0;
            updateNetworkStatus("✅ 网络就绪 | ID: " + id);
            enableLobbyControls(true);
        });

        peer.on('error', function(err) {
            console.error('❌ 网络错误:', err.type, err.message);
            clearTimeout(connectionTimeout);
            
            if (err.type === 'network' || err.type === 'server-error' || err.type === 'unavailable-id') {
                if (peer) peer.destroy();
                peer = null;
                currentServerIndex++;
                tryConnect();
            } else {
                handleConnectionFailure(err.type);
            }
        });

        peer.on('connection', function(c) {
            if (conn && conn.open) {
                c.close();
                return;
            }
            conn = c;
            setupConnectionHandlers();
            myRole = 'red';
            startMultiplayerGame('red');
        });
    }

    tryConnect();
}

function handleConnectionFailure(reason) {
    updateNetworkStatus("⚠️ 联机不可用 (单机模式)");
    enableLobbyControls(true);
    
    if (connectionRetryCount < MAX_RETRY) {
        connectionRetryCount++;
        console.log("🔄 重试 (" + connectionRetryCount + "/" + MAX_RETRY + ")...");
        setTimeout(function() {
            if (peer) peer.destroy();
            peer = null;
            initNetwork();
        }, 3000);
    } else {
        console.log("❌ 停止重试，转为离线模式");
        if (networkStatusEl) {
            networkStatusEl.innerText = "⚠️ 联机服务暂时不可用，可输入房间号尝试或玩单机模式";
            networkStatusEl.style.color = "orange";
        }
    }
}

function setupConnectionHandlers() {
    if (!conn) return;
    
    conn.on('open', function() {
        isMultiplayer = true;
        const roleText = (myRole === 'red') ? "红方" : "蓝方";
        console.log("🔗 联机成功，角色:", roleText);
        updateStatus();
    });
    
    conn.on('data', function(data) {
        console.log("📥 收到数据:", data);
        handleNetworkData(data);
    });
    
    conn.on('close', function() {
        alert("对手断开连接");
        leaveRoom();
    });
    
    conn.on('error', function(err) {
        console.error("连接错误:", err);
    });
}

function handleNetworkData(data) {
    console.log("📡 处理网络数据:", data.type);
    
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
            const opponentColor = (myRole === 'red') ? 'blue' : 'red';
            boardState[data.to.r][data.to.c].hasPiece = opponentColor;
            gameState = 'MOVE_SELECT';  // 【修复】改为 MOVE_SELECT
            currentPlayer = myRole;
            updateStatus();
            renderBoard();
            break;
            
        case 'PLACE_WALL':
            walls.push({ r: data.r, c: data.c, type: data.type });
            gameState = 'MOVE_SELECT';
            currentPlayer = myRole;
            if (boardElement) boardElement.style.pointerEvents = 'auto';
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
        const roomId = prompt("尚未连接到公共服务器。\n请输入您想创建的房间号:", "room" + Math.floor(Math.random() * 1000));
        if (!roomId) return;
        
        updateNetworkStatus("正在尝试创建房间: " + roomId);
        peer = new Peer(roomId, { 
            host: 'peerjs-server.herokuapp.com', 
            port: 443, 
            secure: true 
        });
        peer.on('open', function(id) {
            alert("房间创建成功！房间号: " + id);
            myRole = 'red';
            startMultiplayerGame('red');
            if (roomDisplayEl) roomDisplayEl.innerText = "当前房间: " + id;
        });
        peer.on('error', function() {
            alert("创建失败，该房间号可能已被占用或网络不通");
        });
        return;
    }
    
    alert("房间创建成功！\n房间号: " + peer.id + "\n请发给朋友加入。");
    if (roomDisplayEl) roomDisplayEl.innerText = "当前房间: " + peer.id;
    myRole = 'red';
    startMultiplayerGame('red');
}

function joinRoom() {
    const roomId = prompt("请输入朋友的房间号:");
    if (!roomId) return;
    if (peer && roomId === peer.id) {
        alert("不能加入自己的房间！");
        return;
    }

    updateNetworkStatus("正在连接: " + roomId + "...");
    
    if (!peer || !peer.id) {
        peer = new Peer(null, { 
            host: 'peerjs-server.herokuapp.com', 
            port: 443, 
            secure: true 
        });
        peer.on('open', function() {
            connectToRoom(roomId);
        });
        peer.on('error', function() {
            alert("无法连接服务器");
        });
    } else {
        connectToRoom(roomId);
    }
}

function connectToRoom(roomId) {
    const c = peer.connect(roomId);
    conn = c;
    myRole = 'blue';
    setupConnectionHandlers();
    
    c.on('open', function() {
        startMultiplayerGame('blue');
    });
    c.on('error', function() {
        alert("连接失败，房间号错误或对方不在线");
    });
}

function enableLobbyControls(enable) {
    if (roomInput) roomInput.disabled = !enable;
    if (createBtn) createBtn.disabled = !enable;
    if (joinBtn) joinBtn.disabled = !enable;
    console.log("控件状态更新:", enable ? "启用" : "禁用");
}

function updateNetworkStatus(msg) {
    if (networkStatusEl) {
        networkStatusEl.innerText = msg;
        if (msg.indexOf("✅") >= 0) {
            networkStatusEl.style.color = "green";
        } else if (msg.indexOf("❌") >= 0) {
            networkStatusEl.style.color = "red";
        } else {
            networkStatusEl.style.color = "#666";
        }
    }
}

function leaveRoom() {
    if (conn) conn.close();
    if (peer) peer.destroy();
    conn = null;
    peer = null;
    isMultiplayer = false;
    myRole = null;
    
    if (lobbyControls) lobbyControls.style.display = 'block';
    if (gameControls) gameControls.style.display = 'none';
    
    updateNetworkStatus("已退出 (单机模式)");
    enableLobbyControls(true);
    initGame();
}

function startMultiplayerGame(role) {
    initGame();
    
    if (role === 'blue') {
        gameState = 'WAITING_OPPONENT';
        if (statusText) {
            statusText.innerText = "等待红方放置棋子...";
            statusText.style.color = "#999";
        }
        // 【修复】蓝方等待时也不禁用点击，方便调试
        if (boardElement) boardElement.style.pointerEvents = 'auto';
    } else {
        gameState = 'PLACE_RED';
        if (boardElement) boardElement.style.pointerEvents = 'auto';
    }
    
    if (lobbyControls) lobbyControls.style.display = 'none';
    if (gameControls) gameControls.style.display = 'block';
    
    if (myRoleEl) {
        myRoleEl.innerText = (role === 'red') ? "我是红方 (先手)" : "我是蓝方 (后手)";
        myRoleEl.style.color = (role === 'red') ? "#ff4d4f" : "#1890ff";
    }
    updateStatus();
}

function sendMove(data) {
    if (conn && conn.open) {
        conn.send(data);
        console.log("📤 发送数据:", data);
    } else {
        console.warn("⚠️ 连接未打开，无法发送数据");
    }
}
