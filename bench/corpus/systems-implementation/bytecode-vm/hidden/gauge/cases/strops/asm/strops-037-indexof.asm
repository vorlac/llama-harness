; case strops-037-indexof
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR ""
  INDEXOF
  PRINT
  RET
.end
