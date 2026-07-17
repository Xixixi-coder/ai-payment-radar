# 埋点方案 - 外场AI付 SDK + AI付开通前端页

> 所属项目：PRD-外场AI付*健康大为医生*Rokid合作
> 
> 埋点范围：外场AI付 SDK + AI付开通前端页（含眼镜SDK协同）
>
> 提报人：王嘉怡（wangjiayi85）

---

## 目录

1. 版本记录
2. 埋点概述
3. 外场AI付 SDK 埋点
4. AI付开通前端页 埋点
5. 【关联】眼镜SDK 协同埋点建议
6. 【关联】手机端AI付SDK 埋点建议
7. 参数数据字典

---

## 1. 版本记录

| 版本 | 内容 | 作者 | 日期 |
|------|------|------|------|
| V1.0 | 新建 | 王嘉怡 | 2025-06-中 |

---

## 2. 埋点概述

### 2.1 埋点目的

- 跟踪外场AI付 SDK在Rokid眼镜/手机端的调用与使用情况
- 跟踪AI付开通前端页各环节转化漏斗
- 跟踪签约、核验（声纹/免验/加验）、支付（发起、回调、结果）全链路数据
- 跟踪双端收音（眼镜+手机）、声纹采集与开通流程关键节点
- 为后续外场AI付（外单）运营调优提供数据支撑

### 2.2 埋点范围

| 模块 | 埋点系统 | 负责人 |
|------|---------|--------|
| **外场AI付 SDK** | SDK自埋点（外场AI付SDK内部） | 石坚 |
| **AI付开通前端页** | H5页面埋点 | 赵旋 |
| **眼镜SDK**（关联） | SDK自埋点（集成到Rokid SDK） | 廖亚伟 |
| **手机端AI付SDK**（关联） | SDK自埋点（AI付SDK） | 本次未嵌入 |

### 2.3 核心埋点维度公共参数

公共参数说明（每次上报的基础字段）：

| 字段名 | 说明 | 取值示例 |
|--------|------|---------|
| pageId | 页面ID / 模块标识 | `aipay_sdk` / `aipay_open_page` |
| userId | 用户pin（已脱敏） | *脱敏后* |
| sessionId | 本次支付会话ID（每次支付生成一个） | `aipay_sdk_20250615_xxxxx` |
| deviceType | 设备类型 | `glass` / `mobile` |
| sceneId | 场景标识 | `rokid_aipay` / `dawei_doc` |
| orderId | 订单ID | `xxxxxxx` |
| merchantId | 商户ID（外单场景） | 服务商商户号 |
| timestamp | 事件时间戳 | `2025-06-15T10:00:00+08:00` |

---

## 3. 外场AI付 SDK 埋点

### 3.1 SDK初始化

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `sdk_init_start` | SDK初始化开始 | SDK被接入方调用初始化时 | `deviceType`, `sceneId`, `sdkVersion` | 记录SDK初始化开始 |
| `sdk_init_success` | SDK初始化成功 | 初始化完成 | `deviceType`, `sceneId`, `sdkVersion`, `initCostMs` | 初始化耗时 |
| `sdk_init_fail` | SDK初始化失败 | 初始化异常 | `deviceType`, `sceneId`, `sdkVersion`, `failReason` | 失败原因（如：参数缺失、网络异常等） |

### 3.2 签约状态管理

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `bind_check_start` | 绑定状态检查开始 | SDK开始查询用户签约绑定状态 | - | |
| `bind_check_result` | 绑定状态检查结果 | 查询返回 | `isBound: true/false`, `hasOpenAipay: true/false`, `hasVoiceprint: true/false` | 记录当前用户签约状态 |
| `bind_check_fail` | 绑定状态检查失败 | 查询异常 | `failReason` | |
| `bind_start` | 绑定（签约）开始 | 用户发起绑定时 | `bindType: voiceprint/authcode` | 签约类型 |
| `bind_success` | 绑定（签约）成功 | 绑定完成 | `bindCostMs`, `bindType` | 绑定耗时 |
| `bind_fail` | 绑定（签约）失败 | 绑定异常 | `failReason`, `bindType` | |
| `bind_cancel` | 绑定（签约）取消 | 用户取消绑定 | - | |
| `unbind_start` | 解约开始 | 用户发起解约 | - | |
| `unbind_success` | 解约成功 | 解约完成 | - | |
| `unbind_fail` | 解约失败 | 解约异常 | `failReason` | |

### 3.3 核验

> 核验方式：免验（声纹文本核验）、加验（8位数字核验）

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `verify_decision` | 核验决策 | AI付核验方式决策完成 | `verifyType: none/voiceprint/authcode`, `isOverLimit: true/false` | 是否超免密额度等 |
| `verify_start` | 核验开始 | 发起核验 | `verifyType` | |
| `verify_success` | 核验成功 | 核验通过 | `verifyType`, `verifyCostMs` | |
| `verify_fail` | 核验失败 | 核验未通过 | `verifyType`, `failReason` | 失败原因（如：声纹不匹配、加验错误、重试超限） |
| `verify_retry` | 核验重试 | 用户重试核验 | `verifyType`, `retryCount` | 记录重试次数 |
| `verify_timeout` | 核验超时 | 核验超过时间限制 | `verifyType`, `timeoutMs` | |

### 3.4 发起支付

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `payment_init` | 发起支付 | AI付SDK开始发起支付 | `paymentMode: direct/verifyFirst`, `riskParams*` | 直接支付或加验后支付 |
| `payment_submit` | 支付请求提交 | 支付请求已发出 | `orderId`, `amount`, `merchantId` | |
| `payment_submit_fail` | 支付请求提交失败 | 发出请求异常 | `failReason` | |

### 3.5 支付回调

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `callback_received` | 支付回调收到 | 支付服务端回推结果 | `resultCode`, `resultMsg` | 收到回调 |
| `payment_success` | 支付成功 | 回调结果为成功 | `orderId`, `payAmount`, `payChannel` | |
| `payment_fail` | 支付失败 | 回调结果为失败 | `orderId`, `failReason`, `failType` | 失败原因（如：余额不足、风控拦截、通道失败） |
| `payment_timeout` | 支付超时 | 支付超过等待时长未响应 | `timeoutMs` | |

### 3.6 流程编排

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `flow_decision` | 流程编排决策 | SDK根据场景/状态决定流程 | `sceneId`, `currentState`, `nextAction: showContract/showOpen/showPay/showFallback` | 记录当前用户的流程走向 |
| `flow_fallback` | 兜底流程触发 | 用户无法使用AI付 | `fallbackType: noCard/notOpen/notBound/riskBlocked`, `fallbackAction: redirectToPayment/jumpToOpenUrl` | 兜底方案 |

### 3.7 SDK整体异常

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `sdk_error` | SDK异常 | 内部逻辑异常 | `errorType`, `errorMsg`, `errorStack` | 技术侧排查用 |

---

## 4. AI付开通前端页 埋点

> 前端页包含：loading页、AI付开通页、声纹双端收音开通流程

### 4.1 Loading页

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `loading_enter` | 进入loading页 | 用户进入loading页 | `deviceType`, `from: sdk/url` | 由SDK唤起还是URL跳入 |
| `loading_exit` | 离开loading页 | 离开loading页 | `exitTo: openPage/openFail/redirect`, `loadCostMs` | 最终分流去向 |
| `loading_close` | loading页关闭 | 用户手动关闭 | - | |

### 4.2 AI付开通页

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `open_page_enter` | 进入开通页 | 进入AI付开通页 | `deviceType`, `sceneId` | |
| `open_page_impress` | 开通页展示 | 页面渲染完成 | `pageRenderMs` | 页面加载耗时 |
| `open_agreement_show` | 开通协议展示 | 协议条款展示给用户 | - | |
| `open_agreement_accept` | 用户同意协议 | 用户勾选/同意开通协议 | - | |
| `open_agreement_reject` | 用户拒绝协议 | 用户拒绝开通协议 | - | |
| `open_page_start_bind` | 开始绑定 | 用户点击开通/确认绑定 | `bindType` | |
| `open_page_bind_success` | 绑定成功 | 调用payuser绑定成功 | `bindCostMs` | 绑定耗时 |
| `open_page_bind_fail` | 绑定失败 | 绑定异常 | `failReason` | |
| `open_page_success` | 开通完成 | AI付开通全流程完成 | `totalCostMs`, `hasVoicePrint: true/false` | |
| `open_page_exit` | 离开开通页 | 离开开通页 | `exitType: success/fail/cancel/redirect` | |
| `open_page_redirect` | 跳转到其他流程 | 跳转到非AI付流程（如收银台还款页） | `redirectUrl` | |

### 4.3 声纹双端收音开通流程

> 眼镜端+手机端协同收音，开通声纹能力

| 埋点事件ID | 事件名 | 触发时机 | 参数 | 说明 |
|-----------|--------|---------|------|------|
| `voiceprint_enter` | 进入声纹开通流程 | 进入双端收音页面 | `deviceType` | |
| `voiceprint_instruction` | 声纹引导播放 | 引导用户朗读文本 | `textType: fixed/random` | |
| `voiceprint_recording_start` | 开始收音 | 用户开始朗读 | `deviceType: glass/mobile`, `recordType: single/dual` | 单端收音/双端收音 |
| `voiceprint_recording_complete` | 收音完成 | 用户完成朗读 | `recordCostMs`, `audioLengthMs` | |
| `voiceprint_recording_fail` | 收音异常 | 收音失败 | `failReason: noise/tooShort/interrupt/timeout` | |
| `voiceprint_upload_start` | 声纹上传开始 | 音频上传至服务端 | - | |
| `voiceprint_upload_success` | 声纹上传成功 | 上传完成 | `uploadCostMs` | |
| `voiceprint_upload_fail` | 声纹上传失败 | 上传异常 | `failReason` | |
| `voiceprint_register_success` | 声纹注册成功 | 服务端注册完成 | `registerCostMs` | |
| `voiceprint_register_fail` | 声纹注册失败 | 注册异常 | `failReason` | |
| `voiceprint_retry` | 声纹开通重试 | 用户重试声纹开通 | `retryCount` | |
| `voiceprint_skip` | 跳过声纹开通 | 用户跳过声纹 | - | |

### 4.4 开通全流程漏斗

| 漏斗步骤 | 事件 | 说明 |
|---------|------|------|
| 1 | `open_page_enter` → `open_page_impress` | 进入→展示完成 |
| 2 | `open_agreement_show` → `open_agreement_accept` | 展示→勾选协议 |
| 3 | `open_page_start_bind` → `open_page_bind_success` | 开始绑定→绑定成功 |
| 4 | `voiceprint_enter` → `voiceprint_register_success`（有声纹场景） | 进入声纹→注册完成 |
| 5 | → `open_page_success` | 整体开通成功 |

---

## 5. 【关联】眼镜SDK 协同埋点建议

> 眼镜SDK由廖亚伟负责，集成在原有rokid SDK上，负责收音和唤起支付SDK

| 埋点事件ID | 事件名 | 触发时机 | 参数 |
|-----------|--------|---------|------|
| `glass_sdk_init` | 眼镜SDK初始化 | 眼镜端集成调用 | `sdkVersion` |
| `glass_voiceprint_capture` | 眼镜端声纹收音 | 眼镜端双端收音采集 | `audioQuality`, `durationMs` |
| `glass_payment_invoke` | 眼镜端唤起支付SDK | 眼镜端调用支付SDK | `paymentType` |
| `glass_payment_result` | 眼镜端支付结果 | 收到支付端返回 | `resultCode` |
| `glass_network_error` | 眼镜端网络异常 | 眼镜端通信异常 | `errorType` |

---

## 6. 【关联】手机端AI付SDK 埋点建议

> 手机端AI付SDK（本期未嵌入，预留）

| 埋点事件ID | 事件名 | 触发时机 | 参数 |
|-----------|--------|---------|------|
| `mobile_sdk_init` | 手机端AI付SDK初始化 | 手机端首次调用 | `sdkVersion` |
| `mobile_payment_invoke` | 手机端发起支付 | SDK调用支付接口 | `paymentMode` |
| `mobile_payment_result` | 手机端支付结果 | 收到回调 | `resultCode`, `resultMsg` |
| `mobile_sdk_error` | 手机端SDK异常 | 内部异常 | `errorType` |

---

## 7. 参数数据字典

### 7.1 设备类型

| 枚举值 | 说明 |
|--------|------|
| `glass` | Rokid眼镜端 |
| `mobile` | 手机端（Rokid APP） |
| `unknown` | 未知设备 |

### 7.2 核验类型

| 枚举值 | 说明 |
|--------|------|
| `none` | 免验（声纹文本核验） |
| `voiceprint` | 声纹核验 |
| `authcode` | 8位数字加验 |

### 7.3 绑定类型

| 枚举值 | 说明 |
|--------|------|
| `voiceprint` | 声纹绑定 |
| `authcode` | 加验绑定 |

### 7.4 支付失败类型

| 枚举值 | 说明 |
|--------|------|
| `balance_insufficient` | 余额不足 |
| `risk_blocked` | 风控拦截 |
| `channel_fail` | 通道失败 |
| `user_cancel` | 用户取消 |
| `network_error` | 网络异常 |
| `timeout` | 超时 |
| `unknown` | 未知 |

### 7.5 场景ID

| 枚举值 | 说明 |
|--------|------|
| `rokid_aipay` | Rokid外场AI付（核心场景） |
| `rokid_dawei_doc` | 大为医生内单场景 |
| `rokid_service_provider` | 服务商入驻场景 |

### 7.6 兜底类型

| 枚举值 | 说明 |
|--------|------|
| `noCard` | 无可用支付工具 |
| `notOpen` | 未开通AI付 |
| `notBound` | 未绑定支付账号 |
| `riskBlocked` | 风控限制 |

---

## 附录：埋点上报建议

1. **上报SDK**：建议外场AI付SDK统一使用京东标准埋点SDK上报，AI付开通前端页使用前端埋点SDK上报
2. **上报时机**：用户操作触发事件立即上报
3. **批量上报**：非关键路径（如技术异常）支持延迟批量上报
4. **数据看板**：建议开通后建数据看板监测以下核心指标：
   - SDK初始化成功率
   - 签约（绑定）转化率
   - 核验通过率（细分免验/加验）
   - 支付成功率
   - 开通全流程转化漏斗
   - 声纹双端收音成功率
   - 眼镜端/手机端对比数据