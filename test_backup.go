package main
import (
    "time"
)
type TaskInfo struct {
    TaskID      string
    Name        string
    Type        string
    Status      string
    Progress    int
    Speed       string
    StartTime   time.Time
    EndTime     time.Time
    ElapsedTime string
    ETA         string
    CurrentFile string
    ErrorMsg    string
}
type HealthReport struct {
    DecryptOk  bool
    TarOk      bool
    DBCheckOk  bool
    ComposeOk  bool
    Summary    string
}
var activeTasksMutex struct {
    Lock func()
    Unlock func()
}
var activeTasks map[string]*TaskInfo = make(map[string]*TaskInfo)
var currentConfig struct {
    TelegramBotToken string
    TelegramChatID   string
    BackupPassword   string
}
var configMutex struct {
    Lock func()
    Unlock func()
}

func saveTaskToHistory(t *TaskInfo) {}
func runTrackedCommand(a, b, c string, d ...string) (string, error) { return "", nil }
func verifyBackupPackage(a, b string) HealthReport { return HealthReport{} }
func sendTelegramMessage(a string) {}
func copyFile(a, b string) error { return nil }
func addLocalPullManifest(a string, b int64, c time.Time) {}
func getFileSizeString(a string) string { return "" }
func fileInfoSize(a string) int64 { return 0 }
func uploadFileToTelegram(a, b string) (int, string, error) { return 0, "", nil }
func saveTelegramRecordDirectly(a string, b int, c string, d int64) {}
func syncBackupFileToClouds(a, b string) {}
func syncRestoreScriptsToPools() {}

func executeBackup(backupType string, isManual bool) (string, error) {
	// 1. 去重校验 (手动运行除外)
	if !isManual {
		if checkAndSaveDeduplication(backupType) {
			return fmt.Sprintf("[DEDUPLICATION] 检测到 %s 备份对象无文件变更，跳过本次备份。", backupType), nil
		}
	}

	// 注册全局主任务，用于防重和全生命周期展示
	mainTaskID := fmt.Sprintf("t_%s_main_%d", backupType, time.Now().UnixNano())
	mainTask := &TaskInfo{
		TaskID:      mainTaskID,
		Name:        fmt.Sprintf("主灾备归档任务 (%s)", backupType),
		Type:        backupType + "_backup",
		Status:      "running",
		StartTime:   time.Now(),
		Progress:    5,
		CurrentFile: "正在初始化备份上下文...",
	}
	activeTasksMutex.Lock()
	activeTasks[mainTaskID] = mainTask
	activeTasksMutex.Unlock()
	saveTaskToHistory(mainTask)

	var finalErr error
	defer func() {
		activeTasksMutex.Lock()
		mainTask.EndTime = time.Now()
		dur := mainTask.EndTime.Sub(mainTask.StartTime)
		mainTask.ElapsedTime = fmt.Sprintf("%02d:%02d", int(dur.Minutes()), int(dur.Seconds())%60)
		if finalErr != nil {
			mainTask.Status = "error"
			mainTask.ErrorMsg = finalErr.Error()
		} else {
			mainTask.Status = "success"
			mainTask.Progress = 100
			mainTask.CurrentFile = "任务成功完成"
		}
		delete(activeTasks, mainTaskID)
		activeTasksMutex.Unlock()
		saveTaskToHistory(mainTask)
	}()

	// 2. 调用备份脚本 (backup.sh 只负责物理打包，不负责分发和删除临时包)
	mainTask.CurrentFile = "正在调用物理打包脚本生成快照..."
	mainTask.Progress = 10
	saveTaskToHistory(mainTask)

	outputStr, err := runTrackedCommand(backupType+"_backup", "打包物理快照 ("+backupType+")", "/bin/bash", "/app/backup.sh", backupType)
	if err != nil {
		finalErr = err
		return outputStr, err
	}

	// 3. 正则提取生成的临时文件绝对路径
	re := regexp.MustCompile(`\[BACKUP_FILE_CREATED\]\s+(\S+)`)
	matches := re.FindStringSubmatch(outputStr)
	if len(matches) < 2 {
		finalErr = fmt.Errorf("未能从脚本输出中找到生成的物理备份包路径")
		return outputStr, finalErr
	}
	tempFilePath := matches[1]

	// 4. 安全沙箱可用性与一致性健康校验 (优先执行)
	log.Printf("[VERIFY] 正在对新临时快照 %s 执行安全沙箱还原及健康度一致性检测...", tempFilePath)
	mainTask.CurrentFile = "正在进行安全沙箱还原及数据库语法/完整性检验..."
	mainTask.Progress = 40
	saveTaskToHistory(mainTask)

	report := verifyBackupPackage(tempFilePath, backupType)
	log.Printf("[VERIFY] 报告摘要: %s", report.Summary)

	reportData, _ := json.MarshalIndent(report, "", "  ")
	outputStr += fmt.Sprintf("\n\n==================================================\n🔬 灾备健康度验证报告 (Sandbox Health Check)\n==================================================\n%s\n", string(reportData))

	// 如果校验失败，立即熔断！
	if !report.DecryptOk || !report.TarOk || (backupType == "db" && !report.DBCheckOk) || (backupType == "sys" && !report.ComposeOk) {
		log.Printf("[VERIFY] 快照健康度验证未通过，终止归档与云端分发任务！")
		warnMsg := fmt.Sprintf("⚠️【灾备验证失败警报】\n文件名: %s\n类型: %s\n\n%s", filepath.Base(tempFilePath), backupType, report.Summary)
		sendTelegramMessage(warnMsg)
		os.Remove(tempFilePath)
		finalErr = fmt.Errorf("安全沙箱一致性健康验证未通过: %s", report.Summary)
		return outputStr, finalErr
	}

	// 5. 校验通过，保存为本地正式物理冷备
	mainTask.CurrentFile = "正在将经过验证的快照归档至本地冷备池..."
	mainTask.Progress = 60
	saveTaskToHistory(mainTask)

	fileName := filepath.Base(tempFilePath)
	var localDestDir string
	if backupType == "db" {
		localDestDir = "/config/local_backup/hourly_db"
	} else {
		localDestDir = "/config/local_backup/system_backup"
	}
	os.MkdirAll(localDestDir, 0755)
	localFinalPath := filepath.Join(localDestDir, fileName)

	log.Printf("[BACKUP] 正在归档快照至本地冷备存储池: %s ...", localFinalPath)
	if err := copyFile(tempFilePath, localFinalPath); err != nil {
		log.Printf("[ERROR] 归档保存至本地物理冷备失败: %v", err)
	} else {
		addLocalPullManifest(fileName, fileInfoSize(localFinalPath), time.Now())
	}

	// 6. 整合投递至 Telegram Bot（合并健康度报告作为 caption）
	mainTask.CurrentFile = "正在向 Telegram 频道投递强加密备份包..."
	mainTask.Progress = 70
	saveTaskToHistory(mainTask)

	configMutex.Lock()
	tgToken := currentConfig.TelegramBotToken
	tgChatID := currentConfig.TelegramChatID
	configMutex.Unlock()

	if tgToken != "" && tgToken != "your_telegram_bot_token_here" && tgChatID != "" {
		tag := "#database_backup"
		captionTitle := "🔒 Shield-Backup 数据库加密热备 (验证通过)"
		if backupType == "sys" {
			tag = "#system_inc_backup"
			captionTitle = "📦 Shield-Backup 系统配置累积增量备份 (验证通过)"
		} else if backupType == "img" {
			tag = "#docker_images_backup"
			captionTitle = "📦 Shield-Backup Docker 运行镜像归档备份 (验证通过)"
		}

		caption := fmt.Sprintf("%s\n🕒 时间: %s\n📄 文件名: %s\n💾 大小: %s\n🏷️ 标签: %s\n\n🔬 验证摘要:\n%s",
			captionTitle,
			time.Now().Format("2006-01-02 15:04:05"),
			fileName,
			getFileSizeString(tempFilePath),
			tag,
			report.Summary,
		)

		log.Printf("[TELEGRAM] 正在上传备份包并合并投递报告...")
		msgID, fileID, err := uploadFileToTelegram(tempFilePath, caption)
		if err != nil {
			log.Printf("[ERROR] Telegram 发送备份失败: %v", err)
		} else {
			log.Printf("[OK] Telegram 备份上传成功，消息 ID: %d", msgID)
			saveTelegramRecordDirectly(fileName, msgID, fileID, fileInfoSize(tempFilePath))
		}
	}

	// 7. 多云端存储同步 (Rclone)
	mainTask.CurrentFile = "正在同步备份包到多云端存储池中..."
	mainTask.Progress = 85
	saveTaskToHistory(mainTask)
	syncBackupFileToClouds(tempFilePath, backupType)

	// 8. 同步恢复脚本随包上传至各存储池
	mainTask.CurrentFile = "正在向各个存储池同步恢复脚本..."
	mainTask.Progress = 95
	saveTaskToHistory(mainTask)
	syncRestoreScriptsToPools()

	// 9. 任务全部完成后，删除临时包，保护 /tmp 磁盘空间
	os.Remove(tempFilePath)

	return outputStr, nil
}
