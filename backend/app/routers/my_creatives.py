from fastapi import APIRouter, Depends, UploadFile, File, Query, Request
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.user_creative import (
    UserCreativeResponse, UserCreativeListResponse,
    CampaignValidationRequest, CampaignValidationResponse,
    EditorRequest,
)
from app.services.my_creatives import (
    upload_user_creative, get_user_creatives, get_user_creative,
    delete_user_creative, validate_creative_for_campaign,
    apply_editor_transform,
)
from app.routers.auth import limiter

router = APIRouter(prefix="/my-creatives", tags=["my-creatives"])


@router.post("/", response_model=UserCreativeResponse, status_code=201)
@limiter.limit("10/minute")
async def upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await upload_user_creative(db, user, file)


@router.get("/", response_model=UserCreativeListResponse)
def list_creatives(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    file_type: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_user_creatives(db, user, page, page_size, file_type)


@router.get("/{creative_id}", response_model=UserCreativeResponse)
def get_detail(
    creative_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_user_creative(db, user, creative_id)


@router.delete("/{creative_id}", status_code=204)
def delete(
    creative_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    delete_user_creative(db, user, creative_id)


@router.post("/{creative_id}/edit", response_model=UserCreativeResponse)
def edit_creative(
    creative_id: int,
    body: EditorRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return apply_editor_transform(db, user, creative_id, body)


@router.post("/validate-for-campaign", response_model=CampaignValidationResponse)
def validate_for_campaign(
    body: CampaignValidationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return validate_creative_for_campaign(db, user, body.creative_id, body.space_id)
