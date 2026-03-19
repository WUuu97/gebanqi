// ================= 配置常量 =================
const BOARD_SIZE = 8;
const CELL_SIZE = 50;       // 格子宽度 (px)
const GAP_SIZE = 2;         // 缝隙宽度 (px)
const TOTAL_STEP = CELL_SIZE + GAP_SIZE; // 52px (一个格子+一个缝隙)
const WALL_THICKNESS = GAP_SIZE + 4;     // 隔板视觉厚度 (6px)
const HIT_TOLERANCE = 15;   // 鼠标命中容错半径 (px)，解决角落手抖问题

// ================= 游戏状态 =================
let boardState = [];        // 棋盘数据 { hasPiece: 'red' | 'blue' | null }
let walls = [];             // 已放置的隔板 [{r, c, type}]
let currentPlayer = 'red';  // 当前玩家 'red' | 'blue'
let gameState = 'PLACE_RED'; // 游戏阶段
let selectedPiecePos = null; // 当前选中的棋子位置 {r, c}
let hoverWall = null;       // 当前悬停预览的隔板 {r, c, type}
let lastMousePos = { x: -9999, y: -9999 }; // 全局缓存鼠标坐标 (相对于boardElement)

// ================= DOM 元素 =================
const boardElement = document.getElementById('board');
const statusText = document.getElementById('status-text');
const modeDisplay = document.getElementById('mode-display');

// ================= 初始化 =================
function initGame() {
    boardState = [];
    walls = [];
    currentPlayer = 'red';
    gameState = 'PLACE_RED';
    selectedPiecePos = null;
    hoverWall = null;
    lastMousePos = { x: -9999, y: -9999 };

    // 初始化空棋盘
    for (let r = 0; r < BOARD_SIZE; r++) {
        let row = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            row.push({ hasPiece: null });
        }
        boardState.push(row);
    }

    renderBoard();
    updateStatus();

    // 绑定事件
    boardElement.addEventListener('mousemove', handleGlobalMouseMove);
    boardElement.addEventListener('mouseleave', () => {
        if (hoverWall) clearHoverPreview();
    });
}

// ================= 核心渲染 =================
function renderBoard() {
    boardElement.innerHTML = '';

    // 1. 绘制格子
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.r = r;
            cell.dataset.c = c;

            // 绘制棋子
            if (boardState[r][c].hasPiece) {
                const piece = document.createElement('div');
                piece.className = `piece ${boardState[r][c].hasPiece}`;
                cell.appendChild(piece);
            }

            // 高亮可达区域 (MOVE_TARGET 阶段)
            if (gameState === 'MOVE_TARGET' && selectedPiecePos) {
                if (isValidTarget(selectedPiecePos, {r, c})) {
                    cell.classList.add('highlight');
                }
            }

            cell.addEventListener('click', () => handleCellClick(r, c));
            boardElement.appendChild(cell);
        }
    }

    // 2. 绘制已存在的隔板
    walls.forEach(w => createWallDOM(w.r, w.c, w.type, false));

    // 3. 绘制悬停预览隔板
    if (hoverWall) {
        createWallDOM(hoverWall.r, hoverWall.c, hoverWall.type, true);
    }
}

// 创建隔板 DOM (严格单格，坐标精准对齐)
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
    // 坐标计算公式 (必须与检测逻辑完全一致)
    if (type === 'h') {
        // 横向：位于行 r 和 r+1 之间，占据列 c
        top = (r + 1) * TOTAL_STEP - (WALL_THICKNESS / 2);
        left = c * TOTAL_STEP + (GAP_SIZE / 2);
        el.style.width = `${CELL_SIZE}px`;
        el.style.height = `${WALL_THICKNESS}px`;
    } else {
        // 纵向：位于列 c 和 c+1 之间，占据行 r
        top = r * TOTAL_STEP + (GAP_SIZE / 2);
        left = (c + 1) * TOTAL_STEP - (WALL_THICKNESS / 2);
        el.style.height = `${CELL_SIZE}px`;
        el.style.width = `${WALL_THICKNESS}px`;
    }

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    boardElement.appendChild(el);
}

// ================= 交互逻辑 =================

// 全局鼠标追踪 (始终更新)
function handleGlobalMouseMove(e) {
    const rect = boardElement.getBoundingClientRect();
    lastMousePos.x = e.clientX - rect.left;
    lastMousePos.y = e.clientY - rect.top;

    // 只有在放墙模式下才进行检测
    if (['PLACE_RED_WALL', 'PLACE_BLUE_WALL', 'WALL_PLACE'].includes(gameState)) {
        detectHoverWall(lastMousePos.x, lastMousePos.y);
    }
}

// ================= 修改后的交互逻辑 (支持联机) =================

function handleCellClick(r, c) {
    const cell = boardState[r][c];

    // 联机模式：如果是对手回合，禁止操作
    if (isMultiplayer && gameState === 'WAITING_OPPONENT') {
        return;
    }

    // 1. 红方放置棋子 (仅限单机 或 联机主机)
    if (gameState === 'PLACE_RED') {
        if (!cell.hasPiece) {
            boardState[r][c].hasPiece = 'red';
            selectedPiecePos = { r, c };
            gameState = 'PLACE_RED_WALL';
            finishSetupPhase();
            // 联机：如果是主机，不需要发消息，客人处于等待状态，直到主机放完墙
        } else { if(!isMultiplayer) alert("此处已有棋子"); }
        return;
    }

    // 2. 蓝方放置棋子 (仅限单机 或 联机客人 - 实际上客人是被动等待，不会触发此状态)
    // 在联机逻辑中，客人加入时 gameState 是 WAITING_OPPONENT，不会进到这里
    if (gameState === 'PLACE_BLUE') {
        if (!cell.hasPiece) {
            boardState[r][c].hasPiece = 'blue';
            selectedPiecePos = { r, c };
            gameState = 'PLACE_BLUE_WALL';
            finishSetupPhase();
        } else { if(!isMultiplayer) alert("此处已有棋子"); }
        return;
    }

    // 3. 选择移动棋子
    if (gameState === 'MOVE_SELECT') {
        if (cell.hasPiece === currentPlayer) {
            selectedPiecePos = { r, c };
            gameState = 'MOVE_TARGET';
            renderBoard();
            updateStatus();
        }
        return;
    }

    // 4. 确认移动目标
    if (gameState === 'MOVE_TARGET') {
        if (!selectedPiecePos) return;
        
        if (isValidTarget(selectedPiecePos, { r, c })) {
            // 构建移动数据包
            const moveData = { type: 'MOVE_PIECE', from: selectedPiecePos, to: { r, c } };

            if (isMultiplayer) {
                sendMove(moveData);
                // 本地立即执行，保持流畅
                boardState[selectedPiecePos.r][selectedPiecePos.c].hasPiece = null;
                boardState[r][c].hasPiece = currentPlayer;
                selectedPiecePos = { r, c };
                gameState = 'WALL_PLACE';
                renderBoard();
                updateStatus();
                forceDetectAfterMove();
                return;
            } else {
                // 单机逻辑
                boardState[selectedPiecePos.r][selectedPiecePos.c].hasPiece = null;
                boardState[r][c].hasPiece = currentPlayer;
                selectedPiecePos = { r, c };
                gameState = 'WALL_PLACE';
                renderBoard();
                updateStatus();
                forceDetectAfterMove();
            }
        }
        return;
    }
}

// 辅助：完成放置棋子后的通用处理
function finishSetupPhase() {
    renderBoard();
    updateStatus();
    // 放置棋子后也立即检测
    forceDetectAfterMove();
}

// 【核心修复】强制使用当前鼠标位置进行检测
function forceDetectAfterMove() {
    // 如果鼠标还没进入过棋盘，不检测
    if (lastMousePos.x === -9999) return;
    detectHoverWall(lastMousePos.x, lastMousePos.y);
}

// 检测悬停隔板 (核心算法)
function detectHoverWall(mx, my) {
    if (!selectedPiecePos) {
        clearHoverPreview();
        return;
    }

    const pr = selectedPiecePos.r;
    const pc = selectedPiecePos.c;
    const candidates = [];

    // 定义四个方向的“命中矩形”
    
    // 1. 上方横墙 (位于 pr-1 行下方)
    if (pr > 0) {
        const yCenter = pr * TOTAL_STEP - WALL_THICKNESS / 2;
        const xStart = pc * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr - 1, c: pc, type: 'h',
            xMin: xStart - HIT_TOLERANCE, xMax: xStart + CELL_SIZE + HIT_TOLERANCE,
            yMin: yCenter - HIT_TOLERANCE, yMax: yCenter + HIT_TOLERANCE
        });
    }
    // 2. 下方横墙 (位于 pr 行下方)
    if (pr < BOARD_SIZE - 1) {
        const yCenter = (pr + 1) * TOTAL_STEP - WALL_THICKNESS / 2;
        const xStart = pc * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr, c: pc, type: 'h',
            xMin: xStart - HIT_TOLERANCE, xMax: xStart + CELL_SIZE + HIT_TOLERANCE,
            yMin: yCenter - HIT_TOLERANCE, yMax: yCenter + HIT_TOLERANCE
        });
    }
    // 3. 左方纵墙 (位于 pc-1 列右方)
    if (pc > 0) {
        const xCenter = pc * TOTAL_STEP - WALL_THICKNESS / 2;
        const yStart = pr * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr, c: pc - 1, type: 'v',
            xMin: xCenter - HIT_TOLERANCE, xMax: xCenter + HIT_TOLERANCE,
            yMin: yStart - HIT_TOLERANCE, yMax: yStart + CELL_SIZE + HIT_TOLERANCE
        });
    }
    // 4. 右方纵墙 (位于 pc 列右方)
    if (pc < BOARD_SIZE - 1) {
        const xCenter = (pc + 1) * TOTAL_STEP - WALL_THICKNESS / 2;
        const yStart = pr * TOTAL_STEP + GAP_SIZE / 2;
        candidates.push({
            r: pr, c: pc, type: 'v',
            xMin: xCenter - HIT_TOLERANCE, xMax: xCenter + HIT_TOLERANCE,
            yMin: yStart - HIT_TOLERANCE, yMax: yStart + CELL_SIZE + HIT_TOLERANCE
        });
    }

    // 寻找最佳匹配 (距离中心最近且合法的)
    let best = null;
    let minDist = Infinity;

    for (let cand of candidates) {
        // 简单的矩形包含检测
        if (mx >= cand.xMin && mx <= cand.xMax && my >= cand.yMin && my <= cand.yMax) {
            // 计算到几何中心的距离，用于在交叉点优选
            const cx = (cand.xMin + cand.xMax) / 2;
            const cy = (cand.yMin + cand.yMax) / 2;
            const dist = Math.sqrt((mx - cx)**2 + (my - cy)**2);

            if (dist < minDist) {
                // 预检查合法性，如果不合法直接跳过
                if (isValidWallPlacement(cand.r, cand.c, cand.type)) {
                    minDist = dist;
                    best = cand;
                }
            }
        }
    }

    // 更新状态
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

        // 状态流转
        if (gameState === 'PLACE_RED_WALL') {
            gameState = 'PLACE_BLUE';
            selectedPiecePos = null;
            // 联机：主机放完墙，轮到客人放棋子？
            // 规则：红放棋->红放墙->蓝放棋->蓝放墙->红移动
            // 所以红放完墙，应该通知客人进入 PLACE_BLUE
            if (isMultiplayer) {
                // 客人目前的状态是 WAITING_OPPONENT (在 startMultiplayerGame 设置)
                // 我们需要发送一个特殊的信号告诉客人“该你放棋子了”
                // 为了简化，我们可以复用 INIT_STATE 或者直接改客人的状态
                // 简单做法：发送一个 'TURN_CHANGE' 消息，或者直接依赖客人收到 PLACE_WALL 后的逻辑
                // 修改 handleNetworkData 中的 PLACE_WALL 逻辑：
                // 收到 PLACE_WALL: 如果当前是 WAITING (红放墙), 则转为 PLACE_BLUE
            }
        } else if (gameState === 'PLACE_BLUE_WALL') {
            gameState = 'MOVE_SELECT';
            currentPlayer = 'red';
            selectedPiecePos = null;
            // 联机：客人放完墙，轮到主机移动
            if (isMultiplayer) {
                 // 同样，主机收到 PLACE_WALL 后应转为 MOVE_SELECT
            }
        } else if (gameState === 'WALL_PLACE') {
            // 检查胜利
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
    } else {
        console.warn("尝试放置非法隔板");
    }
}

// 验证隔板合法性 (仅针对紧邻当前棋子的操作)
function isValidWallPlacement(r, c, type) {
    // 1. 边界检查 (棋盘边缘不能放)
    if (type === 'h') {
        if (r < 0 || r >= BOARD_SIZE - 1) return false;
        if (c < 0 || c >= BOARD_SIZE) return false;
    } else {
        if (r < 0 || r >= BOARD_SIZE) return false;
        if (c < 0 || c >= BOARD_SIZE - 1) return false;
    }

    // 2. 重叠检查
    if (walls.some(w => w.r === r && w.c === c && w.type === type)) return false;

    // 3. 紧邻检查 (必须紧贴当前选中的棋子)
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

// 验证移动目标 (BFS)
function isValidTarget(from, to) {
    if (from.r === to.r && from.c === to.c) return false; // 不能原地不动
    if (boardState[to.r][to.c].hasPiece) return false;    // 不能有棋子
    
    const reachable = getReachableCells(from.r, from.c);
    return reachable.some(p => p.r === to.r && p.c === to.c);
}

// BFS 寻路 (获取连通区域)
function getReachableCells(startR, startC) {
    const visited = new Set();
    const queue = [{ r: startR, c: startC }];
    const result = [];
    visited.add(`${startR},${startC}`);

    while (queue.length > 0) {
        const { r, c } = queue.shift();
        result.push({ r, c });

        const dirs = [
            { dr: -1, dc: 0, wType: 'h', wr: r - 1, wc: c }, // 上
            { dr: 1, dc: 0, wType: 'h', wr: r, wc: c },      // 下
            { dr: 0, dc: -1, wType: 'v', wr: r, wc: c - 1 }, // 左
            { dr: 0, dc: 1, wType: 'v', wr: r, wc: c }       // 右
        ];

        for (let d of dirs) {
            const nr = r + d.dr, nc = c + d.dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;

            // 检查是否有墙阻挡
            if (walls.some(w => w.type === d.wType && w.r === d.wr && w.c === d.wc)) continue;

            // 检查是否有对方棋子阻挡
            if (boardState[nr][nc].hasPiece && boardState[nr][nc].hasPiece !== currentPlayer) continue;

            const key = `${nr},${nc}`;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push({ r: nr, c: nc });
            }
        }
    }
    return result;
}

// 更新状态文本
function updateStatus() {
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
    }
    statusText.innerText = msg;
    statusText.style.color = color;
    modeDisplay.innerText = gameState;
}

// ================= 胜利判定逻辑 (精确计算可放隔板数) =================

// ================= 胜利判定逻辑 (修复版：正确判断连通性) =================

function checkWin() {
    const redPos = findPiece('red');
    const bluePos = findPiece('blue');
    
    if (!redPos || !bluePos) return true; 

    // 1. 常规胜利：对方无路可走
    const nextPlayer = currentPlayer === 'red' ? 'blue' : 'red';
    const nextPos = nextPlayer === 'red' ? redPos : bluePos;
    
    // 临时切换视角计算“移动能力” (必须排除对方棋子)
    const originalPlayer = currentPlayer;
    currentPlayer = nextPlayer;
    // 过滤掉起点本身，看是否有其他可去之地
    const nextMoves = getReachableCells(nextPos.r, nextPos.c, true).filter(p => !(p.r === nextPos.r && p.c === nextPos.c));
    currentPlayer = originalPlayer; // 立即切回

    if (nextMoves.length === 0) {
        showWinMessage(`${currentPlayer === 'red' ? '红方' : '蓝方'} 获胜`, "对方已无路可走！");
        return true;
    }

    // 2. 隔断胜利：检查红蓝是否连通
    // 【修复核心】：连通的定义是“能否到达对方棋子所在的格子”
    // 即使规则规定不能“停留”在对方格子上，但只要能“到达”（即相邻且无墙），就算连通。
    // 我们使用一个特殊的连通检查函数，它暂时忽略“对方棋子不可进入”的限制，只检查墙壁。
    
    const isConnect = checkConnectivity(redPos, bluePos);

    if (!isConnect) {
        // 双方已被完全隔断，计算双方领地内还能放多少个隔板
        // 注意：这里计算领地大小时，应该基于实际的“移动可达范围”（即不包含对方）
        const redWallCount = countValidWallPlacements(redPos);
        const blueWallCount = countValidWallPlacements(bluePos);
        
        let winnerText = "";
        let reasonText = `双方已被完全隔断！根据规则，统计双方领地内剩余可放置的隔板数量：\n\n`;
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

/**
 * 专门用于检查两个棋子是否连通（只检查墙壁，忽略对方棋子的阻挡）
 * 如果从 start 能走到 end 的位置（即使 end 有对方棋子），则返回 true
 */
function checkConnectivity(startPos, endPos) {
    const visited = new Set();
    const queue = [{ r: startPos.r, c: startPos.c }];
    visited.add(`${startPos.r},${startPos.c}`);

    while (queue.length > 0) {
        const { r, c } = queue.shift();

        // 如果当前节点就是目标节点，说明连通
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
            
            // 边界检查
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;

            // 【关键区别】：只检查墙壁，不检查棋子！
            // 即使 (nr, nc) 有对方棋子，我们也允许“走进去”来判断连通性
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

/**
 * 精确计算某一方棋子所在连通区域内，还可以放置多少个隔板
 * 这里的连通区域定义遵循“移动规则”：不能穿过对方棋子。
 * 所以这里继续使用标准的 getReachableCells (带 ignoreOpponent=true)
 */
function countValidWallPlacements(piecePos) {
    // 获取该棋子所在连通区域的所有格子坐标集合
    // 注意：这里必须用标准的移动逻辑（不能穿过对方），因为这是计算“实际领地”
    const reachableSet = new Set();
    // 第三个参数 true 表示启用标准阻挡检查（包括对方棋子）
    const reachableList = getReachableCells(piecePos.r, piecePos.c, true);
    
    reachableList.forEach(p => reachableSet.add(`${p.r},${p.c}`));

    let count = 0;

    // --- 检查所有可能的横向隔板 ---
    for (let r = 0; r < BOARD_SIZE - 1; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const topCell = `${r},${c}`;
            const bottomCell = `${r+1},${c}`;
            
            // 只有当隔板两侧的格子都属于我的“实际领地”时，这个隔板才算我能放的
            if (reachableSet.has(topCell) && reachableSet.has(bottomCell)) {
                if (!walls.some(w => w.type === 'h' && w.r === r && w.c === c)) {
                    count++;
                }
            }
        }
    }

    // --- 检查所有可能的纵向隔板 ---
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

// 修改 getReachableCells 签名，增加 ignoreOpponent 参数
// 默认 true (遵循移动规则)，在 checkConnectivity 中我们不用这个函数，而是自己写循环
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

            // 检查墙壁
            if (walls.some(w => w.type === d.wType && w.r === d.wr && w.c === d.wc)) continue;

            // 检查棋子阻挡
            if (ignoreOpponent) {
                // 如果开启阻挡检查：遇到对方棋子不能走
                if (boardState[nr][nc].hasPiece && boardState[nr][nc].hasPiece !== currentPlayer) continue;
            }
            // 如果 ignoreOpponent 为 false，则忽略棋子阻挡（本函数主要供移动和面积计算用，通常传 true）
            // 注：checkConnectivity 函数已独立实现，不走这里

            const key = `${nr},${nc}`;
            if (!visited.has(key)) {
                visited.add(key);
                queue.push({ r: nr, c: nc });
            }
        }
    }
    return result;
}

function showWinMessage(title, detail) {
    setTimeout(() => {
        alert(`🏆 ${title}\n\n${detail}`);
        initGame();
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

// 启动游戏
initGame();
// ================= 联机模块 (PeerJS) =================

let peer = null;
let conn = null;
let myRole = null; // 'host' (红方) 或 'guest' (蓝方)
let isMultiplayer = false;
const ROOM_PREFIX = "qj-game-"; // 房间名前缀，避免冲突

// 初始化网络
function initNetwork() {
    // 创建 Peer 对象 (使用默认的免费公共服务器)
    // 如果默认服务器不稳定，可以指定 host: '0.peerjs.com', port: 443, secure: true
    peer = new Peer(null, {
        debug: 2
    });

    peer.on('open', (id) => {
        console.log('我的网络 ID:', id);
        updateNetworkStatus("已连接到网络服务器，等待房间...");
    });

    peer.on('error', (err) => {
        console.error('网络错误:', err);
        updateNetworkStatus("网络连接失败: " + err.type);
        alert("联机服务暂时不可用，请刷新页面重试。");
    });

    // 监听他人连接我 (作为主机时)
    peer.on('connection', (c) => {
        if (conn && conn.open) {
            c.close(); // 只允许一个玩家
            return;
        }
        conn = c;
        setupConnection();
        // 主机默认为红方
        myRole = 'red'; 
        startMultiplayerGame('red');
    });
}

// 创建或加入房间
function createRoom() {
    const roomIdInput = document.getElementById('room-id-input').value.trim();
    if (!roomIdInput) {
        alert("请输入房间号！");
        return;
    }
    
    const fullRoomId = ROOM_PREFIX + roomIdInput;

    if (!peer || !peer.id) {
        alert("正在连接网络服务器，请稍后...");
        return;
    }

    // 尝试连接 (作为客人)
    // 注意：PeerJS 的逻辑是，如果 ID 存在则连接，不存在则无法连接。
    // 为了实现“创建或加入”，我们先尝试连接。如果连接失败（对方不存在），我们再“宣称”自己是这个 ID (这需要重新初始化 peer 或者使用特定逻辑)。
    // 简化方案：让用户明确是“创建”还是“加入”，或者使用更简单的逻辑：
    // 方案 A: 主机固定 ID 逻辑比较复杂。
    // 方案 B (推荐): 简单的“加入”逻辑。如果是第一个进来的，他需要先生成 ID。
    // 改进方案 C (最稳健): 
    // 1. 用户输入房间号。
    // 2. 我们尝试连接该房间。
    // 3. 如果连接成功 -> 我是客人 (蓝方)。
    // 4. 如果连接失败 (对方不存在) -> 我把自己重命名为该房间号 (成为主机/红方)。
    
    // 由于 PeerJS ID 一旦生成不能直接改，我们采用以下策略：
    // 每次点击按钮，销毁旧 peer，尝试以 "ROOM_PREFIX + 房间号" 为 ID 启动。
    // 如果启动成功且没有别人连进来 -> 我是主机 (等待别人连我)。
    // 但这样无法区分“我想加入”还是“我想创建”。
    
    // ✅ 最佳实践流程：
    // 1. 生成一个随机 ID 作为临时身份。
    // 2. 尝试连接目标房间 ID。
    // 3. 如果连接成功 -> 加入成功 (蓝方)。
    // 4. 如果连接失败 (err type 'unavailable-id' 或 'peer-unavailable') -> 说明没人，那我重新初始化 peer 并强制占用该 ID (成为主机)。
    
    // 为了代码简单，我们分两个按钮或者简化逻辑：
    // 这里实现：先尝试连接，连不上就自动变成主机。
    
    const targetId = fullRoomId;
    
    // 先尝试连接
    const tempConn = peer.connect(targetId);
    
    let connected = false;

    tempConn.on('open', () => {
        connected = true;
        conn = tempConn;
        setupConnection();
        myRole = 'blue'; // 后来者是蓝方
        startMultiplayerGame('blue');
        updateNetworkStatus(`已加入房间：${roomIdInput} (你是蓝方)`);
    });

    tempConn.on('error', (err) => {
        if (!connected) {
            // 连接失败，说明房间没人，那我创建它
            // 必须重新创建一个 Peer 实例并指定 ID
            if (peer) peer.destroy();
            
            setTimeout(() => {
                peer = new Peer(targetId, { debug: 2 });
                peer.on('open', () => {
                    updateNetworkStatus(`房间 ${roomIdInput} 创建成功！(你是红方)\n等待对手加入...`);
                    myRole = 'red';
                    startMultiplayerGame('red');
                    
                    // 重新监听连接
                    peer.on('connection', (c) => {
                        if (conn && conn.open) { c.close(); return; }
                        conn = c;
                        setupConnection();
                        alert("对手已加入！游戏开始。");
                    });
                });
                peer.on('error', (e) => {
                    alert("房间号被占用了或网络错误，请换一个房间号。");
                    initNetwork(); // 恢复随机 ID 状态
                });
            }, 500);
        }
    });
    
    // 超时处理 (如果对方 ID 不存在，PeerJS 可能会挂起一会)
    setTimeout(() => {
        if (!connected && !conn) {
             // 这里的逻辑主要靠 error 事件触发，超时仅作为兜底提示
             // 实际上 'peer-unavailable' 错误会很快触发
        }
    }, 3000);
}

function leaveRoom() {
    if (conn) conn.close();
    if (peer) peer.destroy();
    conn = null;
    peer = null;
    isMultiplayer = false;
    myRole = null;
    
    document.getElementById('lobby-controls').style.display = 'block';
    document.getElementById('game-controls').style.display = 'none';
    updateNetworkStatus("已退出房间 (单机模式)");
    
    // 重置游戏为单机
    initGame();
    alert("已退出联机，恢复单机模式。");
}

function setupConnection() {
    conn.on('data', (data) => {
        handleNetworkData(data);
    });
    
    conn.on('close', () => {
        alert("对手已断开连接！");
        leaveRoom();
    });
    
    isMultiplayer = true;
    document.getElementById('lobby-controls').style.display = 'none';
    document.getElementById('game-controls').style.display = 'block';
    document.getElementById('my-role').innerText = myRole === 'red' ? "我是红方 (先手)" : "我是蓝方 (后手)";
    document.getElementById('my-role').style.color = myRole === 'red' ? "#ff4d4f" : "#1890ff";
}

function startMultiplayerGame(role) {
    // 重置游戏状态
    initGame();
    
    // 如果是蓝方 (guest)，需要禁用初始放置，等待红方操作
    if (role === 'blue') {
        gameState = 'WAITING_OPPONENT';
        updateStatus();
        statusText.innerText = "等待红方放置棋子...";
        statusText.style.color = "#999";
        // 禁止点击
        boardElement.style.pointerEvents = 'none'; 
    } else {
        // 红方正常开始
        gameState = 'PLACE_RED';
        updateStatus();
        boardElement.style.pointerEvents = 'auto';
    }
}

// 发送数据
function sendMove(data) {
    if (conn && conn.open) {
        conn.send(data);
    }
}

// 接收数据处理
function handleNetworkData(data) {
    switch (data.type) {
        case 'MOVE_PIECE':
            executeRemoteMove(data.from, data.to);
            break;
        case 'PLACE_WALL':
            // 执行放墙
            walls.push({ r: data.r, c: data.c, type: data.type });
            
            // 根据当前状态推断下一步
            // 如果我在等红方放墙 (我是蓝方，状态 WAITING)，收到后 -> 该我放棋子 (PLACE_BLUE)
            // 如果我在等蓝方放墙 (我是红方，状态 WAITING)，收到后 -> 该我移动 (MOVE_SELECT)
            
            if (myRole === 'red') {
                // 我是红方，收到蓝方的墙 -> 蓝方回合结束 -> 轮到我移动
                gameState = 'MOVE_SELECT';
                currentPlayer = 'red';
                statusText.innerText = "红方：点击己方棋子准备移动";
                boardElement.style.pointerEvents = 'auto';
            } else {
                // 我是蓝方，收到红方的墙 -> 
                // 此时可能是开局阶段 (红放完墙，该蓝放棋) 或 正常回合 (红放完墙，该蓝移动)?
                // 回看流程：
                // 1. 红棋 -> 红墙 -> (此时蓝还没下棋) -> 蓝棋 -> 蓝墙 -> 红移 -> 红墙 -> 蓝移
                // 所以：
                // 如果 gameState 是 WAITING 且 还没下过蓝棋 (需要一个标记)，则是 PLACE_BLUE
                // 否则是 MOVE_SELECT
                
                // 简单判断：如果蓝方棋子还没下 (boardState 里没有 blue)，那就是 PLACE_BLUE
                const blueExists = findPiece('blue');
                if (!blueExists) {
                    gameState = 'PLACE_BLUE';
                    statusText.innerText = "蓝方：请点击棋盘放置棋子";
                    currentPlayer = 'blue'; // 虽然还没动，但逻辑上是蓝方操作
                } else {
                    gameState = 'MOVE_SELECT';
                    currentPlayer = 'blue';
                    statusText.innerText = "蓝方：点击己方棋子准备移动";
                }
                boardElement.style.pointerEvents = 'auto';
            }
            
            hoverWall = null;
            renderBoard();
            updateStatus();
            
            // 检查胜利 (虽然通常是发送方检查，但双重保险)
            if (checkWin()) {
                // checkWin 会 alert 并 initGame，这会打断流程，但在联机中最好由发送方主导
                // 这里如果不发送 GAME_OVER，可能会导致状态不同步
                // 既然发送方已经发了 GAME_OVER，这里可能收不到，或者收到了已经重置了
                // 为了安全，如果 checkWin 返回 true，且不是收到 GAME_OVER 触发的，
                // 说明发送方没检测到？不可能。
                // 所以这里不做额外处理，信任发送方。
            }
            break;
        case 'GAME_OVER':
            alert("游戏结束：" + data.msg);
            initGame();
            leaveRoom(); // 结束后退房
            break;
    }
}
// 辅助：更新网络状态文字
function updateNetworkStatus(msg) {
    const el = document.getElementById('network-status');
    if (el) el.innerText = "当前状态: " + msg;
}
// 启动时初始化网络
// 在文件最后，initGame() 之后调用
initNetwork();

// 远程执行移动 (不触发发送，不检查胜利，因为发送方已经检查过了)
function executeRemoteMove(from, to) {
    boardState[from.r][from.c].hasPiece = null;
    boardState[to.r][to.c].hasPiece = (myRole === 'red' ? 'blue' : 'red'); // 对方棋子
    
    // 更新选中位置 (如果是对方回合，不需要选中，但为了逻辑统一)
    // 切换回合
    currentPlayer = myRole; // 轮到我了吗？
    
    // 逻辑流转：对方走完 -> 放墙 -> 我走
    // 这里需要根据具体游戏阶段判断，简化处理：
    // 收到移动包，说明对方完成了移动，现在轮到对方放墙，或者如果我方是下一轮移动者...
    // 由于我们的游戏流程是：移动 -> 放墙 -> 换人。
    // 对方发了 MOVE，说明对方刚移动完，接下来对方要放墙。
    // 所以我方应该处于 "等待对方放墙" 状态。
    
    // 修正状态机同步：
    // 最简单的方法：发送方在发送前已经改变了全局状态，接收方直接同步状态字符串？
    // 不，最好同步动作。
    
    // 重新梳理状态同步：
    // 1. 红方移动 -> 发送 MOVE -> 蓝方执行 MOVE -> 蓝方进入 WAIT_FOR_WALL (红方放墙)
    // 2. 红方放墙 -> 发送 WALL -> 蓝方执行 WALL -> 蓝方进入 MOVE_SELECT (蓝方移动)
    
    if (myRole === 'red') {
        // 我是红方，收到蓝方的移动 -> 蓝方移动完了，该蓝方放墙 -> 我等待
        gameState = 'WAITING_OPPONENT'; 
        statusText.innerText = "等待蓝方放置隔板...";
        boardElement.style.pointerEvents = 'none';
    } else {
        // 我是蓝方，收到红方的移动 -> 红方移动完了，该红方放墙 -> 我等待
        gameState = 'WAITING_OPPONENT';
        statusText.innerText = "等待红方放置隔板...";
        boardElement.style.pointerEvents = 'none';
    }
    
    selectedPiecePos = null;
    renderBoard();
    updateStatus();
}

function executeRemoteWall(r, c, type) {
    walls.push({ r, c, type });
    
    if (myRole === 'red') {
        // 收到蓝方放的墙 -> 蓝方回合结束 -> 轮到我 (红方) 移动
        gameState = 'MOVE_SELECT';
        currentPlayer = 'red';
        statusText.innerText = "红方：点击己方棋子准备移动";
        boardElement.style.pointerEvents = 'auto';
    } else {
        // 收到红方放的墙 -> 红方回合结束 -> 轮到我 (蓝方) 移动
        gameState = 'MOVE_SELECT';
        currentPlayer = 'blue';
        statusText.innerText = "蓝方：点击己方棋子准备移动";
        boardElement.style.pointerEvents = 'auto';
    }
    
    hoverWall = null;
    renderBoard();
    updateStatus();
    
    // 检查是否游戏结束 (双方都要检查，以防网络延迟导致状态不一致，虽然发送方检查了)
    // 但为了保险，接收方也检查一下，如果结束了就不切换状态
    if (checkWin()) {
        // checkWin 会弹窗并重置，这里不需要额外操作
        // 但要阻止上面的状态切换吗？checkWin 返回 true 时已经 initGame 了
        // 所以如果上面执行了 initGame，这里的赋值会被覆盖，没问题。
        // 但如果 checkWin 没触发（比如只是普通放墙），则继续。
    }
}