; case compare-094-nestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "Z"
  PUSH_STR "a"
  NE
  PRINT
  RET
.end
