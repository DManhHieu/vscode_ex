package com.example.demo.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AppConfig {

    @Value("${spring.datasource.url:jdbc:postgresql://localhost:5432/fallback}")
    private String datasourceUrl;

    public String getDatasourceUrl() {
        return datasourceUrl;
    }
}
