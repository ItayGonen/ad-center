from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "mysql+pymysql://root:YourStrongPassword@localhost:3306/ad_booking"
    JWT_SECRET: str = "super-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 1440
    GOOGLE_CLIENT_ID: str = ""
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_SES_REGION: str = "eu-west-1"
    SES_SENDER_EMAIL: str = ""
    ADMIN_EMAIL: str = ""
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000,http://192.168.56.1:5173, http://192.168.56.1:8000"
    ADMIN_INIT_EMAIL: str = ""
    ADMIN_INIT_PASSWORD: str = ""
    ADMIN_INIT_NAME: str = "Admin"

    class Config:
        env_file = ".env"


settings = Settings()
