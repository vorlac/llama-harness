; case closures-008-upvalorder
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  CLOSURE mk
  PUSH_INT 3
  PUSH_INT 4
  CALL 2
  CALL 0
  PRINT
  RET
.end
.func mk arity=2 locals=2
  CLOSURE pair
  RET
.end
.func pair arity=0 locals=0 upvals=2
  .upval local 1
  .upval local 0
  LOAD_UPVAL 0
  LOAD_UPVAL 1
  SUB
  RET
.end
