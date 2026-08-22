; case binary-009-upvaldesc
; expect exit=0 stdout=""
.func main arity=0 locals=1
  PUSH_INT 3
  STORE_LOCAL 0
  CLOSURE get
  CALL 0
  PRINT
  RET
.end
.func get arity=0 locals=0 upvals=1
  .upval local 0
  LOAD_UPVAL 0
  RET
.end
