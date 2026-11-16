/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { bootArenaEngine } from './game/engine';

export default function App() {
  useEffect(() => {
    bootArenaEngine();
  }, []);

  return (
    <div id="app">
      <canvas id="view" tabIndex={0} />
      <div id="ui" />
      <div id="boot">
        <div className="boot-mark">守望争锋</div>
        <div className="boot-sub" id="boot-msg">
          正在载入花村山城 · 三英雄战术战场
        </div>
        <div className="boot-bar">
          <i id="boot-fill" />
        </div>
      </div>
      <div
        id="landscape-guard"
        className="landscape-guard"
        role="region"
        aria-label="横屏游玩提示"
      >
        <div className="lg-card">
          <svg
            className="lg-icon"
            viewBox="0 0 96 72"
            aria-hidden="true"
          >
            <rect
              x="12"
              y="18"
              width="72"
              height="40"
              rx="4"
              fill="rgba(14, 22, 30, 0.9)"
              stroke="#ffb347"
              strokeWidth="2.4"
            />
            <line
              x1="20"
              y1="32"
              x2="20"
              y2="44"
              stroke="#3cff78"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="75" cy="38" r="2.4" fill="#38d4ff" />
            <path
              d="M34 10h28m-5-5l6 5-6 5"
              fill="none"
              stroke="#e8e4da"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h2 className="lg-title">请将设备旋转至横屏</h2>
          <p className="lg-desc">
            《守望争锋 · 花村山城》仅支持横版宽屏视野与双摇杆战术操控，请将手机横向握持后继续战斗。
          </p>
        </div>
      </div>
    </div>
  );
}
