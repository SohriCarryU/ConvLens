# 桌面安全发布指南

适用于后续版本。v0.1.2 已成功发布，既有附件未签名、未公证；本改动不重新发布或修改它们。

## 模式与启用顺序

electron-builder 固定为当前 lockfile 中的 **26.15.3**。`package.json` 保留原有打包目标及文件名，`electron-builder.config.cjs` 叠加安全配置。不要直接使用裸 `electron-builder` 命令绕过该配置，使用 `npm run desktop:dist -- ...`。

| 设置位置 | 名称 | 值与作用 |
| --- | --- | --- |
| Repository Actions Variable | `DESKTOP_SIGNING_MODE` | 默认 `unsigned`；设为 `signed` 后，标签发布要求 Windows 和两个 macOS 架构都完成签名验证 |
| Repository Actions Variable | `WINDOWS_SIGNING_PROVIDER` | 默认 `pfx`；或 `azure`，使用 Azure 托管私钥 |
| 手动运行输入 | `signing_mode` | `configured` 使用仓库变量；`unsigned` / `signed` 仅覆盖本次运行。手动运行永不发布 |
| 本地环境变量 | `CONVLENS_SIGNING_MODE` | 与上述模式相同；默认 `unsigned`。本地签名须在对应操作系统运行 |

1. 由维护者取得下列证书与账号权限，在 **Settings → Secrets and variables → Actions** 配置 Secrets。不要把密码或证书发到 Issue、PR 或构建日志。
2. 先在可信分支手动运行 `signed`；检查三平台构建、原生验证及最终 `convlens-verified-release` artifact。首次启用之前不能宣称安装包已经签名。
3. 在干净的 Windows、Intel Mac、Apple Silicon Mac 上进行下载、安装、启动、训练和本地素材读取验证。最好通过浏览器下载以保留 macOS quarantine 标记，并检查离线启动。CI 的签名验证不能代替这些功能验收。
4. 验证通过后设置 `DESKTOP_SIGNING_MODE=signed`，更新 package.json / package-lock.json 根版本号，再推送新标签。不要重推 v0.1.2。

PR 始终使用 `unsigned`，没有签名凭据；相关配置变更会运行原有三平台打包验证。标签依然使用 Windows x64、macOS Intel x64、macOS Apple Silicon arm64 三个 runner。保留 unsigned 是为了无证书开发及兼容现有流程；公开分发请完成步骤 1–4 后启用 signed。

## Windows 凭据与前置条件

需要受 Windows 信任的代码签名身份及使用私钥的授权。自签名证书不能为公开用户建立信任。当前商业证书经常要求硬件或云端保管私钥，不能假设能导出 PFX；此时使用 Azure 路径，或另行集成经验证的 HSM 签名服务。

### PFX 路径（`WINDOWS_SIGNING_PROVIDER=pfx`）

| GitHub Secret | 内容 |
| --- | --- |
| `WIN_CSC_LINK` | 经 CA 政策允许导出的 `.pfx` / `.p12`（证书及私钥），整个文件的单行 Base64 |
| `WIN_CSC_KEY_PASSWORD` | 证书文件密码（本配置要求非空） |
| `WIN_CERT_SHA1` | 预期签名证书的 40 位十六进制指纹，不含空格或冒号 |

指纹用于匹配证书身份，不是文件签名算法。实际签名使用 SHA256，并请求 RFC 3161 时间戳。换证时同步更新指纹；证书密码和 Base64 都是秘密，Base64 不是加密。

### Azure 路径（`WINDOWS_SIGNING_PROVIDER=azure`）

先开通 Azure Artifact Signing（原 Trusted Signing），完成身份验证并建立受公众信任的证书 profile；创建服务主体，并授予该 profile 的签名权限（文档中的 `Trusted Signing Certificate Profile Signer` 角色或对应的新名称）。需要具备 Azure 订阅、身份审核资格和管理该资源 / 角色的权限。当前 electron-builder 26 的集成通过 `TrustedSigning` PowerShell 模块运行。

| GitHub Secret | 内容 |
| --- | --- |
| `AZURE_TENANT_ID` | 租户 ID |
| `AZURE_CLIENT_ID` | 应用 / 服务主体 Client ID |
| `AZURE_CLIENT_SECRET` | 服务主体密钥的值（不是 secret ID）；应设有效期并定期轮换 |
| `AZURE_SIGNING_ENDPOINT` | 账号所在区域的 HTTPS 签名 endpoint |
| `AZURE_SIGNING_ACCOUNT` | 签名账号名称 |
| `AZURE_SIGNING_PROFILE` | 证书 profile 名称 |
| `WIN_PUBLISHER_NAME` | profile 证书的准确 Common Name，验证时区分大小写 |

此路径不上传 Windows 私钥到 GitHub，不需要 PFX Secrets。权限仅授予所需 profile；后续如迁移 OIDC，须同时验证该版本 PowerShell 模块的身份选择行为，本工作流不声称已实现 OIDC。

Windows CI 检查 Setup EXE、Portable EXE 及打包目录中的 ConvLens.exe：Authenticode 状态为 Valid、签名者与预期一致、存在时间戳，并由 Windows SDK 的 `signtool verify /pa /all /tw` 再次验证。electron-builder 同时负责 NSIS 内部卸载程序签名；CI 没有实际安装 / 卸载应用，首次发布仍需人工验收。已签名也不保证立即消除 SmartScreen 信誉提示。

## macOS 凭据与前置条件

需要有效 Apple Developer Program 会员、**Developer ID Application** 证书及其私钥（不是 Apple Development / Mac App Store 证书），并具备创建或取得该团队公证 API Key 的权限。CI 使用预装 Xcode / Command Line Tools 的 macOS runner；需要能够访问 Apple 公证及票据服务。

| GitHub Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | Developer ID Application 证书和私钥导出的 `.p12`，整个文件的单行 Base64 |
| `MAC_CSC_KEY_PASSWORD` | `.p12` 密码（非空） |
| `MAC_NOTARY_KEY_BASE64` | App Store Connect **团队 API Key** 的 `.p8` 文件，整个文件的单行 Base64 |
| `APPLE_API_KEY_ID` | 对应 Key ID |
| `APPLE_API_ISSUER` | 对应 Issuer ID；请使用支持 issuer 的团队密钥 |
| `APPLE_TEAM_ID` | 证书所属团队的 10 位 Team ID，原生验证据此检查签名团队 |

公证密钥必须有执行 notarization 的角色 / 权限；只有账号所有者、管理员或获授权人员能创建 / 提供这些凭据。请勿提交 Apple 账号密码。这里使用 API Key，不使用 Apple ID / 应用专用密码认证，也不混用两种方式。

`build-signed-mac.mjs` 在 runner 临时目录以 0600 权限创建 `.p8`，将其**路径**作为 `APPLE_API_KEY` 交给 electron-builder；无论子进程成功还是失败都在 finally 中删除。不把 Base64 内容当成文件路径。证书由 electron-builder 导入临时 keychain 并按其生命周期清理；强制取消时最终由 GitHub 托管 runner 销毁环境。使用自托管 runner 时，应额外审查 keychain、临时目录、取消任务和宿主机访问策略。

签名模式开启 Hardened Runtime，主应用和 helper 采用仅允许 V8 JIT 的 entitlement，不关闭 library validation。electron-builder 在打包前完成 Developer ID 签名、公证并向 **.app** 附加票据，再生成 DMG / ZIP。CI 分别验证打包目录、ZIP 解包结果和只读挂载 DMG 中的 .app：

- `codesign --verify --deep --strict`、Developer ID authority、Team ID、runtime 标志、bundle ID 与主可执行文件架构。
- `xcrun stapler validate` 验证 app 内附加票据，`spctl --assess --type execute` 检查 Gatekeeper。

ZIP 本身不能附加公证票据；这里验证其中的 .app。此方案不单独签名、公证或 stapling **DMG 容器本身**，也不声称已完成这一点。任何 Apple 拒绝、公证服务错误、无票据或原生验证失败都会阻止后续发布。签名模式不可降级为 ad-hoc 签名。

## 文件、校验与发布验证

六个安装包沿用原名：

| 平台 | 文件名（`<版本>` 来自 package.json） |
| --- | --- |
| Windows x64 安装 | `ConvLens-<版本>-Setup-x64.exe` |
| Windows x64 便携 | `ConvLens-<版本>-Portable-x64.exe` |
| macOS Intel | `ConvLens-<版本>-mac-x64.dmg`、`ConvLens-<版本>-mac-x64.zip` |
| macOS Apple Silicon | `ConvLens-<版本>-mac-arm64.dmg`、`ConvLens-<版本>-mac-arm64.zip` |

每个平台在原生签名验证（或显式 unsigned 构建）后记录文件名和 SHA256。汇总阶段拒绝缺失、空文件、额外安装包、错误版本 / 架构命名、符号链接、混合签名模式或哈希不匹配，按固定顺序生成并回读 `SHA256SUMS.txt`。签名和 stapling 必须在计算哈希之前完成。

Release 附加 `SECURITY-VERIFICATION.json`，包含本次模式及三平台文件哈希。该报告是 CI 的记录，并非第三方签名证明；操作系统原生验证仍然必要。发布说明由本次模式动态生成，避免把 unsigned 构建标成已签名，或把后续签名版本仍描述为未签名。

标签发布流程仅授予发布 job `contents: write`，构建为 read：检查版本和已有 Release → 三平台构建 / 验证 → 汇总六包及校验文件 → 再次拒绝已有 Release → 创建新草稿并上传（不使用 clobber）→ 从 GitHub 下载全部附件，复核哈希并与原始校验文件和报告逐字节比较 → 公开草稿。预发布版本标记为 prerelease，不设为 latest。

手动运行即使选择旧标签也不会发布。旧标签会使用该标签自身的工作流 / 代码，不会获得本次新增功能；测试此改动请选包含改动的可信分支。已有 Release 的重跑会被拒绝。上传 / 下载验证失败时保留未公开草稿供维护者检查；恢复需要维护者核查并手动处理该草稿或使用新版本，不会自动覆盖附件。

用户下载后可执行：

```bash
# macOS
shasum -a 256 -c SHA256SUMS.txt
# Linux
sha256sum -c SHA256SUMS.txt
```

这些命令要求六个文件均在同目录；仅下载部分时，检查对应一行，缺失其他文件不代表已下载文件损坏。Windows 可用 `Get-FileHash .\ConvLens-<版本>-Setup-x64.exe -Algorithm SHA256` 与对应行比较。SHA256 只能验证完整性，不能单独证明来源，校验文件仍应来自可信 Release。

## 维护与验证

```bash
npm ci
npm test
npm run test:release
npm run build
```

安全测试覆盖缺失凭据、私密数据不进入配置、锁定版本 schema、混合模式、错误产物 / 哈希、校验文件攻击及已有 Release / API 错误保护。三平台 PR 构建只验证 unsigned 路径。**真实签名、公证和系统信任验证仍须配置有效凭据后在相应 runner 完成**，本地 fixture 测试不能证明它们已成功。

仅上传列明的安装包与安全报告，不上传 keychain、证书、临时 .p8、整个 release 目录或 electron-builder 的调试配置。不要启用会打印敏感环境的 shell tracing / 调试日志。限制可推送 release 标签、修改工作流和手动使用 Secrets 的维护者；按需要为可信分支 / 标签设置仓库 rulesets 或受保护 Environment。证书和密钥定期轮换，撤销泄露凭据。

参考官方文档：[electron-builder 26 Windows 签名](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)、[macOS 公证](https://www.electron.build/v26/docs/notarization/)、[Electron 代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)。升级到 electron-builder 27 时签名字段结构有变化，应单独评估和验证，不直接更新 latest。
