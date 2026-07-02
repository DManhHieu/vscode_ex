package com.example.demo.config;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class SchedulerConfig {

    @Scheduled(cron = "${app.cron}")
    public void scheduledTask() {
        // sample scheduled job
    }
}
