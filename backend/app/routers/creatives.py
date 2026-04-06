from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.order import CreativeResponse
from app.services.creatives import upload_creative, get_creatives, delete_creative
from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter(tags=["creatives"])


@router.post("/orders/{order_id}/creatives", response_model=CreativeResponse, status_code=201)
async def upload(order_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return await upload_creative(db, order_id, user, file)


@router.get("/orders/{order_id}/creatives", response_model=list[CreativeResponse])
def list_creatives(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_creatives(db, order_id, user)


@router.delete("/orders/{order_id}/creatives/{creative_id}", status_code=204)
def remove_creative(order_id: int, creative_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    delete_creative(db, order_id, creative_id, user)
