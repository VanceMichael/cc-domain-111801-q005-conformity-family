# ConformityFamily 来源约定

此服务管理配置关联发现、报告适用声明及渠道覆盖接收。
当前常规业务使用一个选定来源上下文处理直接列出的记录。目录请求为 `GET /conformity/models`，返回 `laboratory` 与 `certificates`。每个目录成员以 `id`、`href` 提供来源身份与原文位置，原文中的 `certificate` 和 `laboratory` 必须与目录一致。目录成员可声明各自的 `laboratory`（用于多个实验室共同支撑同一配置的场景），缺省时回落到目录顶层实验室。

## 记录含义

```json
{
  "certificate": "CF100",
  "laboratory": "LAB1",
  "model": "MODEL-A",
  "standard": "STD1",
  "result": "conform",
  "issue": "1"
}
```

这里的字段是来源提供的原始声明，数值文本必须符合十进制规则，不能把空白或未知值转换成零。领域解释保留精确型号归属、实验室与标准、报告版次冲突。只有所选范围内且有充分常规依据的记录列入当前收件；其他范围、待确认、历史和冲突分别保留结果，不用覆盖旧原文消除分歧。

## 公开关联与家族资料

目录成员可以公开关联位置，服务**只沿这些已发布的链接逐跳领取**，不会猜测或拼接任何未授权地址：

```json
{
  "id": "CF100",
  "laboratory": "LAB1",
  "href": "/conformity/models/records/CF100",
  "relations": ["/conformity/models/relations/CF100"]
}
```

关联页（代表型号报告的家族适用声明）再公开补充页与差异说明的位置；链接必须是来源内路径，来源客户端同时强制同源、禁止重定向并限制正文大小。

### 关联页 relation

```json
{
  "family": "FAMILY",
  "certificate": "CF100",
  "representative": "MODEL-A",
  "configuration": { "power": "PSU-A", "module": "M1", "region": "EU" },
  "supplements": ["/conformity/models/supplements/CF100-S2"],
  "differences": ["/conformity/models/differences/CF100-D3"]
}
```

`configuration` 是报告正文实际覆盖的配置约束，而不是网页标题上的系列名。系列名相同但 `representative` 与报告型号不一致时判为冲突；没有公开关联的证书不能凭系列名主张覆盖任何销售配置。

### 补充页 supplement

补充页只能**收窄**适用范围：`narrows` 追加/收紧属性约束，`excludes` 声明明确排除的配置。与现行约束矛盾、或报告版次不一致的补充页标记为冲突，不并入报告链。早先的系列页原文不会因补充页发布而删除，两者都按摘要永久保存，覆盖结论以收窄后的当前口径为准。

```json
{
  "certificate": "CF100",
  "issue": "1",
  "title": "CF100 补充页 S2：收窄区域并排除 M3",
  "issuedAt": "2026-02-01",
  "narrows": { "region": "EU" },
  "excludes": [{ "module": "M3" }]
}
```

### 差异说明 difference

差异说明按 `issuedAt` 顺序生效，用 `from -> to` 替换适用属性；只有当前适用值等于 `from` 时替换才成立，否则标记冲突，防止把不相关的差异套到报告上。差异说明只改它明确声明的属性，其他配置依据保持有效。

```json
{
  "certificate": "CF100",
  "issue": "1",
  "title": "CF100 差异说明 D3：适用模组 M1 调整为 M2",
  "issuedAt": "2026-03-01",
  "change": { "module": { "from": "M1", "to": "M2" } }
}
```

## 销售配置覆盖规则

业务按实际销售配置发起家族领取，每个配置声明自身属性以及需要满足的标准：

```json
{ "name": "C3", "standards": ["STD1"], "attributes": { "power": "PSU-A", "module": "M2", "region": "EU" } }
```

- 一份证书关联页与其补充页、差异说明构成一条**报告链**；销售配置声明的每个维度都被链上当前适用约束覆盖且取值一致，该标准才判定为 `covered`。
- 多个报告可以共同支撑一个配置：不同标准由不同实验室的报告分别承担是允许的；但**同一项检测结论（同一标准）不能把不同实验室的部分依据拼成一次不存在的测试**，此时结论为 `incomplete` 并列出各实验室实际缺的维度。
- 补充页明确排除的配置判为 `excluded`，排除结论可追溯到具体补充页。
- 资料取不到、关联未公开、报告无符合结论等情况一律为 `incomplete`/`review`，交付说明缺的是哪项配置依据，不直接把产品判为不合格。
- 每个覆盖结论都带有报告原文位置、摘要以及关联页/补充页/差异说明的逐页适用声明，可从结论反查回具体报告页。

`collectFamily` 每次按当前可领取资料重算覆盖，并把渠道当前可用包（仅含 `covered` 配置）作为快照存入 `packages` 表；差异说明改变适用模组后，新的领取自动调整领取重点与可用包，仍有效的其他配置不会被重复废弃，历次快照与原文均保留。`previewFamily` 提供不入库的只读预览。单份证书查询仍使用原来的 `collect`/`preview`。

## 本地合作源

`fixtures/source.json` 与 `fixtures/family-source.json` 的 `resources` 是本地来源的 URL 路径到响应正文的映射；只绑定回环地址，不连接真实监管、银行或合作方。原文可通过目录声明的位置取得。`fixtureSource` 支持独立实例、指定路径返回码、一次性来源故障、响应延迟与 `replace` 更新资源；访问记录保留实际请求路径，不凭空生成未收到的响应。测试在进程内操作夹具，不提供对外开放的管理接口。目录不承诺所有关联资料与当前目录同时发布；HTTP 404、403、503 不能自行解释为业务删除，只记为该项依据当前不可领取。

## 原文和收件

原文字节按 SHA-256 寻址，SQLite 保存来源位置、观察时间、收件范围、业务身份、领域记录与决策（`receipts`），渠道包快照保存在 `packages`。收到原文不等于领域接收成功；重复的同一内容不新增收据，同一身份的不同内容不会覆盖原件。`.data/` 仅用于本机数据，演示使用临时目录，运行结束关闭服务并清理临时状态。
