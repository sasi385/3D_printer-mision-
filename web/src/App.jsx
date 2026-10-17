import { useEffect, useState } from "react";

const STALE_MS = 10000; // ไม่มีข้อมูลใหม่เกินนี้ = ออฟไลน์
const LABEL = { printing: "กำลังพิมพ์", idle: "ว่าง", error: "ผิดพลาด", offline: "ออฟไลน์" };
const fmtTime = (s) => `${Math.floor(s / 60)} นาที ${Math.floor(s % 60)} วินาที`;
const pt = (d) => ({ n: d.nozzle.temp, b: d.bed.temp, nt: d.nozzle.target });

function usePrinter() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/printer/history?minutes=3")
      .then((r) => r.json())
      .then((j) => setHistory((j.data || []).slice(-60).map(pt)))
      .catch(() => {});
    const tick = async () => {
      try {
        const r = await fetch("/api/printer/latest");
        if (!r.ok) throw new Error();
        const { data: d } = await r.json();
        setFailed(false);
        if (d) {
          setData(d);
          setHistory((h) => [...h.slice(-59), pt(d)]);
        }
      } catch {
        setFailed(true);
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  const stale = !data || Date.now() - data.ts > STALE_MS;
  return { data, history, failed, offline: failed || stale };
}

function Chart({ history }) {
  const W = 640, H = 220, P = 28, MAX = 250;
  const x = (i) => P + (i / 59) * (W - P * 2);
  const y = (v) => H - P - (v / MAX) * (H - P * 2);
  const path = (k) => history.map((p, i) => `${i ? "L" : "M"}${x(i + 60 - history.length)},${y(p[k])}`).join(" ");
  const target = history.at(-1)?.nt ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="กราฟอุณหภูมิ">
      {[0, 50, 100, 150, 200, 250].map((v) => (
        <g key={v}>
          <line x1={P} x2={W - P} y1={y(v)} y2={y(v)} className="grid" />
          <text x={P - 6} y={y(v) + 4} textAnchor="end" className="tick">{v}</text>
        </g>
      ))}
      {target > 0 && <line x1={P} x2={W - P} y1={y(target)} y2={y(target)} className="tgt" />}
      {history.length > 1 && <path d={path("b")} className="l-b" />}
      {history.length > 1 && <path d={path("n")} className="l-n" />}
    </svg>
  );
}

function Temp({ label, v, note, hot }) {
  return (
    <div>
      <span className="lbl">{label}</span>
      <div className={`big ${hot ? "hot" : ""}`}>{v}<small>°C</small></div>
      <span className="lbl">{note}</span>
    </div>
  );
}

export default function App() {
  const { data, history, failed, offline } = usePrinter();
  const state = offline ? "offline" : data.state;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Wanhao Duplicator 4</h1>
          <p className="sub">อัปเดตล่าสุด {data ? new Date(data.ts).toLocaleTimeString("th-TH") : "—"}</p>
        </div>
        <span className={`badge ${state}`}>{LABEL[state]}</span>
      </header>

      {failed && <div className="notice">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า backend ทำงานอยู่</div>}
      {!failed && offline && data && <div className="notice">ไม่ได้รับข้อมูลจากเครื่องเกิน 10 วินาที ตัวเลขด้านล่างเป็นค่าล่าสุดที่เคยได้รับ</div>}
      {data?.simulated && <div className="notice">กำลังแสดงข้อมูลจำลอง ยังไม่ได้เชื่อมต่อเครื่องจริง</div>}

      {!data ? (
        <p className="sub">ยังไม่มีข้อมูลจากเครื่อง</p>
      ) : (
        <main>
          <section className="card hero">
            <div className="top">
              <Temp hot label="Nozzle" v={data.nozzle.temp} note={`เป้าหมาย ${data.nozzle.target}°C`} />
              <Temp label="Bed" v={data.bed.temp} note={data.bed.target === 0 ? "ฮีตเตอร์ปิดอยู่ (เป้าหมาย 0)" : `เป้าหมาย ${data.bed.target}°C`} />
            </div>
            <Chart history={history} />
            <div className="legend">
              <span><i className="sw" style={{ background: "var(--hot)" }} />Nozzle</span>
              <span><i className="sw" style={{ background: "var(--cool)" }} />Bed</span>
              <span><i className="sw" style={{ background: "var(--ink)" }} />เป้าหมาย nozzle</span>
            </div>
          </section>

          <aside>
            <div className="card">
              <span className="lbl">งานที่กำลังพิมพ์</span>
              {data.job ? (
                <>
                  <h2>{data.job.name}</h2>
                  <div className="bar" role="progressbar" aria-valuenow={Math.round(data.job.progress)} aria-valuemin={0} aria-valuemax={100}>
                    <div style={{ width: `${data.job.progress}%` }} />
                  </div>
                  <p className="sub">{Math.round(data.job.progress)}% · ใช้เวลาไป {fmtTime(data.job.elapsedSec)}</p>
                </>
              ) : (
                <h2>ไม่มีงานพิมพ์</h2>
              )}
            </div>
            <div className="card">
              <span className="lbl">ตำแหน่งหัวพิมพ์ (mm)</span>
              <dl className="pos" style={{ margin: "10px 0 0" }}>
                {["x", "y", "z"].map((k) => (
                  <div key={k}><dt>{k.toUpperCase()}</dt><dd>{data.pos[k]}</dd></div>
                ))}
              </dl>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}
