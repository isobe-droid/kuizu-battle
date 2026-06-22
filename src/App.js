import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, update, onValue } from "firebase/database";
import { QUESTIONS } from "./questions";

const firebaseConfig = {
  databaseURL: "https://wondr-f0acd-default-rtdb.firebaseio.com",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

function pickQuestions(n = 10) {
  return [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, n);
}
function genCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

const C = {
  bg: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
  card: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.12)",
  purple: "#7c3aed",
  purpleLight: "#a78bfa",
  text: "#e2d9f3",
  muted: "#c4b5fd",
  green: "#34d399",
  red: "#f87171",
};

const inp = {
  width: "100%",
  background: "rgba(255,255,255,0.08)",
  border: `1px solid ${C.border}`,
  borderRadius: "10px",
  padding: "12px 16px",
  color: "#fff",
  fontSize: "16px",
  outline: "none",
  boxSizing: "border-box",
};

export default function App() {
  const [screen, setScreen] = useState("home");
  const [myName, setMyName] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [myRole, setMyRole] = useState("");
  const [room, setRoom] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const advancingRef = useRef(false);
  const unsubRef = useRef(null);

  useEffect(() => () => { if (unsubRef.current) unsubRef.current(); }, []);

  function listenRoom(code, qs, role) {
    if (unsubRef.current) unsubRef.current();
    const roomRef = ref(db, `rooms/${code}`);
    unsubRef.current = onValue(roomRef, (snap) => {
      const r = snap.val();
      if (!r) return;
      setRoom(r);
      if (r.status === "result") {
        setScreen("result");
        if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
        return;
      }
      // 両者回答済みなら次へ（ホストのみ処理）
      if (role === "host" && r.status === "playing" && !advancingRef.current) {
        const myAns = r.hostAnswer;
        const opAns = r.guestAnswer;
        if (myAns !== undefined && myAns !== null && myAns !== -1 &&
            opAns !== undefined && opAns !== null && opAns !== -1) {
          advancingRef.current = true;
          setTimeout(() => advanceQuestion(r, qs, code).finally(() => { advancingRef.current = false; }), 1800);
        }
      }
    });
  }

  async function advanceQuestion(r, qs, code) {
    const qIdx = r.qIndex || 0;
    const q = qs[qIdx];
    if (!q) return;
    const hScore = (r.hostScore || 0) + (r.hostAnswer === q.answer ? 1 : 0);
    const gScore = (r.guestScore || 0) + (r.guestAnswer === q.answer ? 1 : 0);
    const nextIdx = qIdx + 1;
    if (nextIdx >= qs.length) {
      await update(ref(db, `rooms/${code}`), { hostScore: hScore, guestScore: gScore, status: "result", hostAnswer: -1, guestAnswer: -1 });
    } else {
      await update(ref(db, `rooms/${code}`), { hostScore: hScore, guestScore: gScore, hostAnswer: -1, guestAnswer: -1, qIndex: nextIdx });
      setSelected(null);
    }
  }

  async function createRoom() {
    if (!myName.trim()) { setError("名前を入力してください"); return; }
    setLoading(true); setError("");
    try {
      const code = genCode();
      const qs = pickQuestions(10);
      const data = {
        host: myName.trim(), guest: "",
        hostAnswer: -1, guestAnswer: -1,
        hostScore: 0, guestScore: 0,
        qIndex: 0, status: "waiting",
        questions: qs.map(q => ({ ...q })),
      };
      await set(ref(db, `rooms/${code}`), data);
      setRoomCode(code);
      setMyRole("host");
      setQuestions(qs);
      setRoom(data);
      setScreen("waiting");
      listenRoom(code, qs, "host");
    } catch (e) {
      setError(`エラー: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    if (!myName.trim()) { setError("名前を入力してください"); return; }
    if (!inputCode.trim()) { setError("コードを入力してください"); return; }
    setLoading(true); setError("");
    try {
      const code = inputCode.trim();
      const snap = await get(ref(db, `rooms/${code}`));
      const r = snap.val();
      if (!r) { setError("ルームが見つかりません"); setLoading(false); return; }
      if (r.guest && r.guest !== "") { setError("満員です"); setLoading(false); return; }
      const qs = r.questions || [];
      await update(ref(db, `rooms/${code}`), { guest: myName.trim(), status: "playing" });
      setRoomCode(code);
      setMyRole("guest");
      setQuestions(qs);
      setRoom({ ...r, guest: myName.trim() });
      setScreen("quiz");
      setSelected(null);
      listenRoom(code, qs, "guest");
    } catch (e) {
      setError(`エラー: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ホスト側: ゲストが参加したらクイズ画面へ
  useEffect(() => {
    if (screen === "waiting" && room?.guest && room.guest !== "") {
      setScreen("quiz");
      setSelected(null);
    }
  }, [room?.guest, screen]);

  async function handleAnswer(i) {
    if (selected !== null) return;
    setSelected(i);
    const myKey = myRole === "host" ? "hostAnswer" : "guestAnswer";
    await update(ref(db, `rooms/${roomCode}`), { [myKey]: i });
  }

  // ゲスト用: 問題が変わったらselectedをリセット
  useEffect(() => {
    if (myRole === "guest") setSelected(null);
  }, [room?.qIndex]);

  function reset() {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    setScreen("home"); setMyName(""); setRoomCode(""); setInputCode("");
    setMyRole(""); setRoom(null); setSelected(null); setError(""); setQuestions([]);
  }

  const qIndex = room?.qIndex ?? 0;
  const q = questions[qIndex];
  const labels = ["A", "B", "C", "D"];
  const myAns = room?.[myRole === "host" ? "hostAnswer" : "guestAnswer"];
  const opAns = room?.[myRole === "host" ? "guestAnswer" : "hostAnswer"];
  const bothAnswered = myAns !== -1 && myAns !== undefined && myAns !== null && opAns !== -1 && opAns !== undefined && opAns !== null;
  const opName = myRole === "host" ? room?.guest : room?.host;
  const myScore = myRole === "host" ? (room?.hostScore || 0) : (room?.guestScore || 0);
  const opScore = myRole === "host" ? (room?.guestScore || 0) : (room?.hostScore || 0);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Hiragino Sans','Meiryo',sans-serif", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: "440px" }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <div style={{ fontSize: "12px", color: C.purpleLight, letterSpacing: "0.15em", marginBottom: "4px" }}>TRIVIA BATTLE</div>
          <h1 style={{ fontSize: "26px", color: "#fff", margin: 0, fontWeight: 700 }}>うんちく対戦</h1>
          <div style={{ fontSize: "11px", color: "#555", marginTop: "4px" }}>100問収録 / 毎回ランダム10問</div>
        </div>

        <div style={{ background: C.card, borderRadius: "20px", border: `1px solid ${C.border}`, padding: "28px 24px" }}>
          {error && <div style={{ background: "rgba(248,113,113,0.15)", border: `1px solid ${C.red}`, borderRadius: "8px", padding: "10px 14px", color: "#fca5a5", fontSize: "12px", marginBottom: "16px", wordBreak: "break-all" }}>⚠️ {error}</div>}

          {screen === "home" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "56px", marginBottom: "12px" }}>⚔️</div>
              <p style={{ color: C.text, fontSize: "14px", lineHeight: 1.7, marginBottom: "28px" }}>別々のスマホでリアルタイム対戦！<br />100問からランダム10問出題</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <button onClick={() => { setError(""); setScreen("create"); }} style={{ width: "100%", background: `linear-gradient(135deg, ${C.purple}, #6d28d9)`, border: "none", borderRadius: "12px", padding: "14px", color: "#fff", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>🏠 ルームを作る</button>
                <button onClick={() => { setError(""); setScreen("join"); }} style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px", color: C.text, fontSize: "15px", cursor: "pointer" }}>🚪 ルームに入る</button>
              </div>
            </div>
          )}

          {screen === "create" && (
            <div>
              <h2 style={{ color: "#fff", fontSize: "18px", margin: "0 0 20px", textAlign: "center" }}>ルームを作る</h2>
              <label style={{ color: C.muted, fontSize: "13px", display: "block", marginBottom: "6px" }}>あなたの名前</label>
              <input value={myName} onChange={e => setMyName(e.target.value)} placeholder="例：磯部" style={inp} />
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={() => setScreen("home")} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", color: C.muted, cursor: "pointer" }}>戻る</button>
                <button onClick={createRoom} disabled={loading} style={{ flex: 2, background: `linear-gradient(135deg, ${C.purple}, #6d28d9)`, border: "none", borderRadius: "10px", padding: "12px", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer" }}>{loading ? "作成中..." : "作成する"}</button>
              </div>
            </div>
          )}

          {screen === "join" && (
            <div>
              <h2 style={{ color: "#fff", fontSize: "18px", margin: "0 0 20px", textAlign: "center" }}>ルームに入る</h2>
              <label style={{ color: C.muted, fontSize: "13px", display: "block", marginBottom: "6px" }}>あなたの名前</label>
              <input value={myName} onChange={e => setMyName(e.target.value)} placeholder="例：田中" style={{ ...inp, marginBottom: "14px" }} />
              <label style={{ color: C.muted, fontSize: "13px", display: "block", marginBottom: "6px" }}>ルームコード（4桁）</label>
              <input value={inputCode} onChange={e => setInputCode(e.target.value)} placeholder="1234" style={{ ...inp, letterSpacing: "0.3em", textAlign: "center", fontSize: "24px", fontWeight: 700 }} maxLength={4} />
              <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                <button onClick={() => setScreen("home")} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", color: C.muted, cursor: "pointer" }}>戻る</button>
                <button onClick={joinRoom} disabled={loading} style={{ flex: 2, background: `linear-gradient(135deg, ${C.purple}, #6d28d9)`, border: "none", borderRadius: "10px", padding: "12px", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer" }}>{loading ? "参加中..." : "参加する"}</button>
              </div>
            </div>
          )}

          {screen === "waiting" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>⏳</div>
              <p style={{ color: C.text, fontSize: "15px", marginBottom: "20px" }}>友達の参加を待っています...</p>
              <div style={{ background: "rgba(167,139,250,0.15)", borderRadius: "14px", padding: "20px", marginBottom: "16px" }}>
                <div style={{ color: C.muted, fontSize: "13px", marginBottom: "8px" }}>ルームコードを友達に教えてね</div>
                <div style={{ color: "#fff", fontSize: "44px", fontWeight: 700, letterSpacing: "0.3em" }}>{roomCode}</div>
              </div>
              <p style={{ color: "#6b7280", fontSize: "12px" }}>参加したら自動でスタートします</p>
            </div>
          )}

          {screen === "quiz" && q && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px" }}>
                <span style={{ color: C.muted, fontSize: "13px" }}>{qIndex + 1}/{questions.length}問</span>
                <span style={{ color: C.muted, fontSize: "13px" }}>自分 {myScore} - {opScore} {opName || "..."}</span>
              </div>
              <p style={{ color: C.text, fontSize: "15px", lineHeight: 1.8, marginBottom: "20px", textAlign: "center", fontWeight: 500 }}>{q.question}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                {q.choices.map((c, i) => {
                  let bg = "rgba(255,255,255,0.06)", border = `1px solid ${C.border}`, color = C.text;
                  if (selected !== null) {
                    if (i === q.answer) { bg = "rgba(52,211,153,0.2)"; border = `1px solid ${C.green}`; color = "#6ee7b7"; }
                    else if (i === selected) { bg = "rgba(248,113,113,0.2)"; border = `1px solid ${C.red}`; color = "#fca5a5"; }
                  }
                  return (
                    <button key={i} onClick={() => handleAnswer(i)} style={{ display: "flex", alignItems: "center", gap: "10px", background: bg, border, borderRadius: "11px", padding: "11px 14px", color, fontSize: "14px", textAlign: "left", cursor: selected !== null ? "default" : "pointer", lineHeight: 1.4 }}>
                      <span style={{ minWidth: "26px", height: "26px", borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>{labels[i]}</span>
                      {c}
                      {selected !== null && i === q.answer && <span style={{ marginLeft: "auto" }}>✅</span>}
                      {selected !== null && i === selected && i !== q.answer && <span style={{ marginLeft: "auto" }}>❌</span>}
                    </button>
                  );
                })}
              </div>
              {selected !== null && (
                <div style={{ marginTop: "14px", padding: "12px 14px", background: "rgba(167,139,250,0.1)", borderRadius: "10px", border: `1px solid rgba(167,139,250,0.3)` }}>
                  {bothAnswered
                    ? <p style={{ color: C.muted, fontSize: "13px", margin: 0, lineHeight: 1.6 }}>{q.explanation}</p>
                    : <p style={{ color: C.muted, fontSize: "13px", margin: 0, textAlign: "center" }}>⏳ {opName || "相手"}の回答待ち...</p>}
                </div>
              )}
            </div>
          )}

          {screen === "result" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "52px", marginBottom: "12px" }}>{myScore > opScore ? "🏆" : myScore < opScore ? "😢" : "🤝"}</div>
              <h2 style={{ color: "#fff", fontSize: "20px", margin: "0 0 6px" }}>{myScore > opScore ? "あなたの勝ち！" : myScore < opScore ? "負けました…" : "引き分け！"}</h2>
              <div style={{ display: "flex", justifyContent: "center", gap: "32px", margin: "20px 0" }}>
                <div><div style={{ color: myScore >= opScore ? C.green : C.red, fontSize: "36px", fontWeight: 700 }}>{myScore}</div><div style={{ color: C.muted, fontSize: "13px" }}>あなた</div></div>
                <div style={{ color: "#555", fontSize: "24px", alignSelf: "center" }}>vs</div>
                <div><div style={{ color: opScore >= myScore ? C.green : C.red, fontSize: "36px", fontWeight: 700 }}>{opScore}</div><div style={{ color: C.muted, fontSize: "13px" }}>{opName || "相手"}</div></div>
              </div>
              <button onClick={reset} style={{ width: "100%", background: `linear-gradient(135deg, ${C.purple}, #6d28d9)`, border: "none", borderRadius: "12px", padding: "13px", color: "#fff", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>トップに戻る</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
